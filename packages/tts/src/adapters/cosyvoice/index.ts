import fs from "fs";
import { Context, Schema } from "koishi";
import path from "path";
import { v4 as uuid } from "uuid";
import WebSocket from "ws";

import { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import { TTSAdapter } from "../base";

// 任务队列中的单个任务定义
interface VoiceTask {
    params: CosyVoiceTTSParams;
    resolve: (result: SynthesisResult) => void;
    reject: (error: Error) => void;
}

// 当前正在处理的任务的状态
interface CurrentTaskState {
    taskId: string;
    filePath: string;
    fileStream: fs.WriteStream;
    params: CosyVoiceTTSParams;
    resolve: (result: SynthesisResult) => void;
    reject: (error: Error) => void;
    finishing: boolean;
    closed: Promise<void>;
}

export interface CosyVoiceConfig extends BaseTTSConfig {
    apiKey: string;
    url: string;
    model: "cosyvoice-v1" | "cosyvoice-v2" | "cosyvoice-v3";
    voice: string;
    enable_ssml: boolean;
}

export const CosyVoiceConfig: Schema<CosyVoiceConfig> = Schema.object({
    apiKey: Schema.string().role("secret").required().description("阿里云百炼 API Key"),
    url: Schema.string().default("wss://dashscope.aliyuncs.com/api-ws/v1/inference/").description("WebSocket 服务器地址"),
    model: Schema.union(["cosyvoice-v1", "cosyvoice-v2", "cosyvoice-v3"]).default("cosyvoice-v2").description("语音合成模型"),
    voice: Schema.string().default("longxiaochun_v2").description("选择想要使用的音色"),
    enable_ssml: Schema.boolean().default(false).description("是否启用 SSML（语音合成标记语言），允许更精细地控制语音"),
});

export interface CosyVoiceTTSParams extends BaseTTSParams {}

export class CosyVoiceAdapter extends TTSAdapter<CosyVoiceConfig, CosyVoiceTTSParams> {
    public readonly name = "cosyvoice";

    private ws: WebSocket;
    private taskQueue: VoiceTask[] = [];
    private isBusy = false;
    private currentTask: CurrentTaskState | null = null;
    private tempDir: string;
    private stopped = false;
    private cancelConnect?: (error: Error) => void;
    private streamClosures = new Set<Promise<void>>();

    constructor(ctx: Context, config: CosyVoiceConfig) {
        super(ctx, config);
        const cacheDir = path.join(ctx.baseDir, "cache");
        fs.mkdirSync(cacheDir, { recursive: true });
        this.tempDir = fs.mkdtempSync(path.join(cacheDir, "koishi-tts-"));
        try {
            this.connect();
        } catch (error) {
            fs.rmSync(this.tempDir, { recursive: true, force: true });
            throw error;
        }
    }

    async stop() {
        this.stopped = true;
        const error = new Error("CosyVoice adapter stopped");
        this.cancelConnect?.(error);
        this.failAll(error);
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) this.ws.terminate();
        await Promise.all(this.streamClosures);
        await fs.promises.rm(this.tempDir, { recursive: true, force: true });
    }

    private connect() {
        if (this.stopped) throw new Error("CosyVoice adapter stopped");
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        const socket = new WebSocket(this.config.url, {
            headers: {
                Authorization: `bearer ${this.config.apiKey}`,
                "X-DashScope-DataInspection": "enable",
            },
        });
        this.ws = socket;
        socket.on("open", () => {
            if (this.ws !== socket || this.stopped) return;
            this.ctx.logger.info("成功连接到 CosyVoice WebSocket 服务器");
            void this.processQueue();
        });
        socket.on("message", (data, isBinary) => {
            if (this.ws === socket && !this.stopped) this.onMessage(data, isBinary);
        });
        socket.on("close", () => {
            if (this.ws === socket) this.failAll(new Error("WebSocket连接意外关闭"));
        });
        socket.on("error", (error) => {
            if (this.ws !== socket) return;
            this.ctx.logger.error("CosyVoice WebSocket 连接出错:", error.message);
            this.failAll(error);
            if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        });
    }

    private onMessage(data: WebSocket.RawData, isBinary: boolean) {
        const task = this.currentTask;
        if (!task || task.finishing) return;
        try {
            if (isBinary) {
                task.fileStream.write(data);
                return;
            }
            const message = JSON.parse(data.toString());
            if (message.header.task_id !== task.taskId) return;
            switch (message.header.event) {
                case "task-started":
                    this.sendTextForCurrentTask(task);
                    break;
                case "task-finished":
                    task.finishing = true;
                    task.fileStream.end(() => { void this.completeTask(task); });
                    break;
                case "task-failed":
                    this.failTask(task, new Error(`任务[${task.taskId}]失败: ${message.header.error_message}`));
                    break;
            }
        } catch (error) {
            this.failTask(task, error instanceof Error ? error : new Error(String(error)));
        }
    }

    private async completeTask(task: CurrentTaskState) {
        try {
            if (this.currentTask !== task || this.stopped) return;
            const audio = await fs.promises.readFile(task.filePath);
            if (this.currentTask !== task || this.stopped) return;
            task.resolve({ audio, mimeType: "audio/mpeg" });
            this.finishCurrentTask(task);
        } catch (error) {
            this.failTask(task, error instanceof Error ? error : new Error(String(error)));
        } finally {
            void this.cleanupTask(task);
        }
    }

    private async cleanupTask(task: CurrentTaskState) {
        await task.closed;
        await fs.promises.unlink(task.filePath).catch(() => {});
    }

    private failTask(task: CurrentTaskState, error: Error) {
        if (this.currentTask !== task) return;
        task.reject(error);
        task.fileStream.destroy();
        void this.cleanupTask(task);
        this.finishCurrentTask(task);
    }

    private failAll(error: Error) {
        // Drain first so finishing a failed task cannot start another queued task.
        for (const task of this.taskQueue.splice(0)) task.reject(error);
        if (this.currentTask) this.failTask(this.currentTask, error);
    }

    private async ensureConnected(): Promise<void> {
        if (this.stopped) throw new Error("CosyVoice adapter stopped");
        this.connect();
        const socket = this.ws;
        if (socket.readyState === WebSocket.OPEN) return;
        if (socket.readyState !== WebSocket.CONNECTING) throw new Error("CosyVoice WebSocket 未连接");
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                socket.off("open", opened);
                socket.off("error", failed);
                socket.off("close", closed);
                if (this.cancelConnect === failed) this.cancelConnect = undefined;
            };
            const opened = () => { cleanup(); resolve(); };
            const failed = (error: Error) => { cleanup(); reject(error); };
            const closed = () => failed(new Error("CosyVoice WebSocket连接已关闭"));
            this.cancelConnect = failed;
            socket.once("open", opened);
            socket.once("error", failed);
            socket.once("close", closed);
        });
    }

    private finishCurrentTask(task: CurrentTaskState) {
        if (this.currentTask !== task) return;
        this.currentTask = null;
        this.isBusy = false;
        void this.processQueue();
    }

    private send(message: string, task: CurrentTaskState) {
        this.ws.send(message, (error) => {
            if (error) this.failTask(task, error);
        });
    }

    private sendTextForCurrentTask(task: CurrentTaskState) {
        this.send(JSON.stringify({
            header: { action: "continue-task", task_id: task.taskId, streaming: "duplex" },
            payload: { input: { text: task.params.text } },
        }), task);
        if (this.currentTask !== task) return;
        this.send(JSON.stringify({
            header: { action: "finish-task", task_id: task.taskId, streaming: "duplex" },
            payload: { input: {} },
        }), task);
    }

    private async processQueue() {
        if (this.stopped || this.isBusy || this.taskQueue.length === 0) return;
        // Reserve the only consumer before waiting for the connection.
        this.isBusy = true;
        try {
            await this.ensureConnected();
            if (this.stopped || !this.taskQueue.length) { this.isBusy = false; return; }
            if (this.ws.readyState !== WebSocket.OPEN) throw new Error("CosyVoice WebSocket 未连接");
            const task = this.taskQueue.shift()!;
            const taskId = uuid();
            const filePath = path.join(this.tempDir, `${taskId}.mp3`);
            let fileStream: fs.WriteStream;
            try {
                fileStream = fs.createWriteStream(filePath);
            } catch (error) {
                task.reject(error instanceof Error ? error : new Error(String(error)));
                throw error;
            }
            const closure = new Promise<void>((resolve) => fileStream.once("close", resolve));
            const current: CurrentTaskState = { ...task, taskId, filePath, fileStream, finishing: false, closed: closure };
            this.currentTask = current;
            // Wait for stream closure before removing the owned directory.
            this.streamClosures.add(closure);
            void closure.then(() => this.streamClosures.delete(closure));
            fileStream.on("error", (error) => this.failTask(current, error));
            this.send(JSON.stringify({
                header: { action: "run-task", task_id: taskId, streaming: "duplex" },
                payload: {
                    task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: this.config.model,
                    parameters: {
                        text_type: "PlainText", voice: this.config.voice, format: "mp3", sample_rate: 24000,
                        volume: 50, rate: 1, pitch: 1, enable_ssml: this.config.enable_ssml,
                    },
                    input: {},
                },
            }), current);
        } catch (error) {
            this.failAll(error instanceof Error ? error : new Error(String(error)));
            this.isBusy = false;
        }
    }

    public synthesize(params: CosyVoiceTTSParams): Promise<SynthesisResult> {
        if (this.stopped) return Promise.reject(new Error("CosyVoice adapter stopped"));
        return new Promise<SynthesisResult>((resolve, reject) => {
            this.taskQueue.push({ params, resolve, reject });
            void this.processQueue();
        });
    }

    public getToolSchema(): Schema {
        return Schema.object({
            text: Schema.string().required().description("你希望通过语音表达的内容"),
        });
    }

    public override getToolDescription(): string {
        let description = super.getToolDescription();
        if (this.config.enable_ssml) {
            description += `
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
</speak>`;
        }
        return description;
    }
}
