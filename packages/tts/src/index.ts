import fs from "fs";
import { Context, Schema, h } from "koishi";
import { Extension, Failed, Infer, PromptService, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import path from "path";
import { v4 as uuid } from "uuid";
import WebSocket from "ws";

export interface Config {
    cosyvoice: {
        apiKey: string;
        url: string;
        model: string;
        voice: string;
        enable_ssml: boolean;
    };
}

// 任务队列中的单个任务定义
interface VoiceTask {
    text: string;
    resolve: (filePath: string) => void;
    reject: (error: Error) => void;
}

// 当前正在处理的任务的状态
interface CurrentTaskState {
    taskId: string;
    filePath: string;
    fileStream: fs.WriteStream;
    text: string;
    resolve: (filePath: string) => void;
    reject: (error: Error) => void;
}

@Extension({
    name: "文本转语音扩展",
    description: "将文本转换为语音进行播放",
    version: "1.0.0",
})
export default class TTSExtension {
    public static readonly Config: Schema<Config> = Schema.object({
        cosyvoice: Schema.object({
            apiKey: Schema.string().role("secret").description("阿里云百炼API Key"),
            url: Schema.string().default("wss://dashscope.aliyuncs.com/api-ws/v1/inference/").description("WebSocket服务器地址"),
            model: Schema.string().default("cosyvoice-v2").description("语音合成模型"),
            voice: Schema.string().default("longxiaochun_v2").description("选择想要使用的音色"),
            enable_ssml: Schema.boolean().default(false).description("是否启用SSML（语音合成标记语言），允许更精细地控制语音"),
        }),
    });

    public static readonly inject = {
        required: ["yesimbot"],
    };

    private ws: WebSocket;
    private taskQueue: VoiceTask[] = [];
    private isBusy: boolean = false;
    private currentTask: CurrentTaskState | null = null;
    private tempDir: string;

    constructor(
        public ctx: Context,
        public config: Config
    ) {
        this.tempDir = fs.mkdtempSync(path.join(ctx.baseDir, "cache", "koishi-tts-"));
        this.connect();

        const promptService: PromptService = ctx.get(Services.Prompt);
        if (config.cosyvoice.enable_ssml) {
            promptService.registerSnippet("tts.config", () => {
                return {
                    enable_ssml: config.cosyvoice.enable_ssml,
                };
            });
        }
    }

    private connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.ws = new WebSocket(this.config.cosyvoice.url, {
            headers: {
                Authorization: `bearer ${this.config.cosyvoice.apiKey}`,
                "X-DashScope-DataInspection": "enable",
            },
        });

        this.ws.on("open", this.onOpen.bind(this));
        this.ws.on("message", this.onMessage.bind(this));
        this.ws.on("close", this.onClose.bind(this));
        this.ws.on("error", this.onError.bind(this));
    }

    private onOpen() {
        this.ctx.logger.info("成功连接到语音合成WebSocket服务器");
        this.processQueue();
    }

    private onMessage(data: WebSocket.RawData, isBinary: boolean) {
        if (!this.currentTask) return;

        if (isBinary) {
            this.currentTask.fileStream.write(data);
        } else {
            const message = JSON.parse(data.toString());

            // 忽略不属于当前任务的消息
            if (message.header.task_id !== this.currentTask.taskId) {
                this.ctx.logger.warn(`收到未知任务ID的消息: ${message.header.task_id}`);
                return;
            }

            switch (message.header.event) {
                case "task-started":
                    this.ctx.logger.info(`任务[${this.currentTask.taskId}]已开始`);
                    this.sendTextForCurrentTask();
                    break;
                case "task-finished":
                    this.ctx.logger.info(`任务[${this.currentTask.taskId}]已完成`);
                    this.currentTask.fileStream.end(() => {
                        this.currentTask.resolve(this.currentTask.filePath);
                        this.finishCurrentTask();
                    });
                    break;
                case "task-failed":
                    const errorMsg = `任务[${this.currentTask.taskId}]失败: ${message.header.error_message}`;
                    this.ctx.logger.error(errorMsg);
                    this.currentTask.fileStream.end(() => {
                        fs.unlink(this.currentTask.filePath, () => {}); // 清理失败的文件
                        this.currentTask.reject(new Error(errorMsg));
                        this.finishCurrentTask();
                    });
                    break;
                default:
                    // 可在此处理 result-generated 等其他事件
                    break;
            }
        }
    }

    private onClose(code: number, reason: Buffer) {
        this.ctx.logger.warn(`与WebSocket服务器的连接已断开，代码: ${code}, 原因: ${reason.toString()}`);
        if (this.currentTask) {
            this.currentTask.reject(new Error("WebSocket连接在任务执行期间意外关闭"));
            this.finishCurrentTask();
        }
    }

    private onError(error: Error) {
        this.ctx.logger.error("WebSocket连接出错:", error.message);
        if (this.currentTask) {
            this.currentTask.reject(error);
            this.finishCurrentTask();
        }
    }

    private async ensureConnected(): Promise<void> {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
            this.ctx.logger.info("WebSocket连接已关闭，正在尝试重连...");
            this.connect();
        }

        if (this.ws.readyState === WebSocket.CONNECTING) {
            return new Promise((resolve) => {
                this.ws.once("open", resolve);
            });
        }
    }

    private finishCurrentTask() {
        this.currentTask = null;
        this.isBusy = false;
        // 尝试处理队列中的下一个任务
        this.processQueue();
    }

    private sendTextForCurrentTask() {
        if (!this.currentTask) return;

        const { taskId, text } = this.currentTask;

        // 发送 continue-task 指令
        const continueTaskMessage = JSON.stringify({
            header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
            payload: { input: { text: text } },
        });
        this.ws.send(continueTaskMessage);
        this.ctx.logger.info(`已为任务[${taskId}]发送待合成文本`);

        // 发送 finish-task 指令
        const finishTaskMessage = JSON.stringify({
            header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
            payload: { input: {} },
        });
        this.ws.send(finishTaskMessage);
        this.ctx.logger.info(`已为任务[${taskId}]发送finish-task指令`);
    }

    private async processQueue() {
        if (this.isBusy || this.taskQueue.length === 0) {
            return;
        }

        await this.ensureConnected();

        if (this.ws.readyState !== WebSocket.OPEN) {
            this.ctx.logger.warn("无法处理队列，WebSocket未连接");
            return;
        }

        this.isBusy = true;
        const task = this.taskQueue.shift();

        const taskId = uuid();
        const outputFilePath = path.join(this.tempDir, `${taskId}.mp3`);

        this.currentTask = {
            taskId: taskId,
            filePath: outputFilePath,
            fileStream: fs.createWriteStream(outputFilePath),
            text: task.text,
            resolve: task.resolve,
            reject: task.reject,
        };

        const runTaskMessage = JSON.stringify({
            header: {
                action: "run-task",
                task_id: taskId,
                streaming: "duplex",
            },
            payload: {
                task_group: "audio",
                task: "tts",
                function: "SpeechSynthesizer",
                model: this.config.cosyvoice.model,
                parameters: {
                    text_type: "PlainText",
                    voice: this.config.cosyvoice.voice,
                    format: "mp3",
                    sample_rate: 24000,
                    volume: 50,
                    rate: 1,
                    pitch: 1,
                    enable_ssml: this.config.cosyvoice.enable_ssml,
                },
                input: {},
            },
        });
        this.ws.send(runTaskMessage);
        this.ctx.logger.info(`已发送run-task消息，开启新任务: ${taskId}`);
    }

    @Tool({
        name: "send_voice",
        description: `将文本转换为语音进行播放。
    - 你应该生成适合朗读、符合口语习惯的自然语言。
    - 避免使用表格、代码块、Markdown链接等不适合口述的格式。
    {{#tts.config.enable_ssml}}
    - SSML 是一种基于 XML 的语音合成标记语言。能让文本内容更加丰富，带来更具表现力的语音效果。
      - <speak> 标签是所有 SSML 标签的根节点，任何使用 SSML 功能的文本内容都必须包含在 <speak></speak> 标签之间。
      - <break> 用于控制停顿时间，在语音合成过程中添加一段静默时间，模拟自然说话中的停顿效果。支持秒（s）或毫秒（ms）单位设置。该标签是可选标签。
        > # 空属性
        > <break/>
        > # 带time属性
        > <break time="500ms"/>
      - <say-as> 用于设置文本的读法（数字、日期、电话号码等）。指定文本是什么类型，并按该类型的常规读法进行朗读。该标签是可选标签。
        指示出标签内文本的信息类型。
        取值范围：
            cardinal：按整数或小数的常见读法朗读
            digits：按数字逐个读出（如：123 → 一二三）
            telephone：按电话号码的常用方式读出
            name：按人名的常规读法朗读
            address：按地址的常见方式读出
            id：适用于账户名、昵称等，按常规读法处理
            characters：将标签内的文本按字符一一读出
            punctuation：将标签内的文本按标点符号的方式读出来
            date：按日期格式的常见读法朗读
            time：按时间格式的常见方式读出
            currency：按金额的常见读法处理
            measure：按计量单位的常见方式读出
        > <speak>
        >  <say-as interpret-as="cardinal">12345</say-as>
        > </speak>
  Example:
    <speak>
      请闭上眼睛休息一下<break time="500ms"/>好了，请睁开眼睛。
    </speak>
    {{/tts.config.enable_ssml}}`,
        parameters: Schema.object({
            text: Schema.string().required().description("你希望通过语音表达的内容"),
        }),
    })
    public async send_voice(args: Infer<{ text: string }>) {
        const { session } = args;

        const text = args.text?.trim() || "";

        if (text == "") {
            return Failed("text is required");
        }

        try {
            const audioFilePath = await new Promise<string>((resolve, reject) => {
                this.taskQueue.push({ text, resolve, reject });
                this.processQueue();
            });

            const audioData = fs.readFileSync(audioFilePath).buffer;

            await session.send(h.audio(audioData, "audio/mpeg"));

            // 发送成功后清理临时文件
            fs.unlink(audioFilePath, (err) => {
                if (err) this.ctx.logger.warn(`清理临时语音文件失败: ${audioFilePath}`, err.message);
            });

            return Success();
        } catch (err) {
            const retryable = err.message === "WebSocket连接在任务执行期间意外关闭";
            this.ctx.logger.error("语音合成或发送失败:", err.message);
            this.ctx.logger.error(err);
            return Failed({ name: "Error", message: `语音合成失败: ${err.message}`, retryable });
        }
    }
}
