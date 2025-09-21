import * as crypto from "crypto";
import { performance } from "perf_hooks";
import { AssetService, Extension, Failed, WithSession, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { Context, Logger, Schema } from "koishi";

/**
 * 简单的计时器，用于统计代码块执行时间
 */
class Timer {
    private startTime: number;

    constructor() {
        this.startTime = performance.now();
    }

    /**
     * 停止计时并返回格式化的耗时字符串
     * @returns {string} e.g., "1.234s"
     */
    stop(): string {
        const duration = (performance.now() - this.startTime) / 1000;
        return `${duration.toFixed(3)}s`;
    }
}

/**
 * 自定义 API 错误类，包含 status 和 body
 */
class ApiError extends Error {
    constructor(
        public status: number,
        public body: any,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// --- 类型定义 ---
interface GenerateArgs {
    prompt: string;
    negative_prompt: string;
    steps: number;
    cfg_scale: number;
    height: number;
    width: number;
}

interface GenerateResult {
    task_id: string;
}

interface TaskResult {
    image: string;
    code: number; // API 状态码：0/200: 成功, 其他: 失败/处理中
    censor: {
        is_nsfw: boolean;
    };
}

// --- 配置定义 ---
export interface Config {
    token: string;
    endpoint: string;
    preset: string;
    usePreset: boolean;
    defaultArgs: Omit<GenerateArgs, "prompt" | "width" | "height">;
}

export const ConfigSchema: Schema<Config> = Schema.object({
    token: Schema.string().required().role("secret").description("RR3 的访问令牌"),
    endpoint: Schema.string().default("https://rr3.t4wefan.pub").description("RR3 的 API 端点"),
    preset: Schema.string()
        .default("[artist:kedama milk],[artist:ask(askzy)],artist:wanke,artist:wlop")
        .role("textarea", { rows: [2, 4] })
        .description("默认的正面提示词预设，会自动加在用户输入的前面"),
    usePreset: Schema.boolean().default(true).description("是否启用正面提示词预设"),
    defaultArgs: Schema.object({
        negative_prompt: Schema.string()
            .default(
                "lips,realistic,{{{nsfw}}}, lowres, bad, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands"
            )
            .role("textarea", { rows: [2, 4] })
            .description("默认的反向提示词"),
        steps: Schema.number().default(23).description("生成图片的迭代步数。数值越高细节越多，但耗时越长"),
        cfg_scale: Schema.number().default(6).description("提示词相关性强度。数值越高，画面越贴近提示词，但可能降低创造性"),
    }).description("默认的生成参数"),
});

@Extension({
    name: "txt2img-rr3",
    display: "图片生成 (RR3)",
    description: "基于 RR3 API 实现的图片生成功能",
    version: "1.2.0",
})
export default class RR3 {
    static readonly inject = [Services.Asset];
    static readonly Config = ConfigSchema;
    private assetService: AssetService;

    // 预设尺寸，便于LLM选择
    private readonly orientationPresets = {
        portrait: { width: 832, height: 1216 }, // 竖屏，适合手机壁纸、人物肖像
        landscape: { width: 1216, height: 832 }, // 横屏，适合PC壁纸、风景画
        square: { width: 1024, height: 1024 }, // 方形，适合头像
    };

    constructor(
        public ctx: Context,
        public config: Config
    ) {
        this.assetService = ctx[Services.Asset];
        this.ctx.on("ready", () => {
            this.ctx.logger.info("插件已成功启动");
        });
    }

    @Tool({
        // 简洁、面向 LLM 的描述
        name: "generate_image",
        description: "根据文本描述生成一张高质量的动漫风格图片，返回图片的资源 ID。",
        // 为 LLM 设计的参数
        parameters: Schema.object({
            prompt: Schema.string()
                .required()
                .description(
                    "图片的详细描述。使用英文逗号分隔的关键词。结构应为：(核心主体), (主体细节), (构图/视角), (背景), (画风)。例如：1girl, solo, silver hair, red eyes, cat ears, looking at viewer, upper body, night sky, by wlop"
                ),
            orientation: Schema.union([
                Schema.const("portrait").description("竖屏构图，适用于肖像或手机壁纸"),
                Schema.const("landscape").description("横屏构图，适用于风景或桌面壁纸"),
                Schema.const("square").description("方形构图，适用于头像"),
            ])
                .default("portrait")
                .description("选择图片的构图方向。portrait 为竖屏，landscape 为横屏，square 为方形") as Schema<string>,
        }),
    })
    async generateImage(args: WithSession<{ prompt: string; orientation: string }>) {
        const totalTimer = new Timer();
        this.ctx.logger.info(`开始执行 generateImage 任务, 提示词: "${args.prompt}"`);

        try {
            // 根据 LLM 选择的 orientation 获取具体尺寸
            const dimensions = this.orientationPresets[args.orientation];
            this.ctx.logger.info(`选择构图: ${args.orientation} (${dimensions.width}x${dimensions.height})`);

            const prompt = this.config.usePreset ? `${this.config.preset},${args.prompt}` : args.prompt;

            // 组装最终生成参数
            const options: GenerateArgs = {
                ...this.config.defaultArgs,
                ...dimensions,
                prompt,
            };
            this.ctx.logger.debug("完整生成参数: %o", options);

            // --- 同步执行流程 ---
            const secret = await this.getSecret(this.config.token);
            const submission = await this.submitTask(options, secret);

            if (!submission.task_id) {
                throw new Error("任务提交失败，API 未返回 task_id");
            }

            this.ctx.logger.info(`任务提交成功 (Task ID: ${submission.task_id})，正在等待同步返回结果...`);

            // 直接调用 getTask 并等待其完成，因为 API 是同步阻塞的
            const finalTask = await this.getTaskResult(submission.task_id);

            // 检查任务结果
            if (finalTask.code === 0 || finalTask.code === 200) {
                if (!finalTask.image) {
                    return Failed("任务成功，但 API 未返回有效的图片数据");
                }
                this.ctx.logger.info("任务成功，正在保存图片资源...");
                if (finalTask.censor?.is_nsfw) {
                    this.ctx.logger.warn("任务结果被标记为 NSFW");
                }
                const imageBuffer = Buffer.from(finalTask.image, "base64");
                const assetId = await this.assetService.create(imageBuffer, { filename: `rr3-${submission.task_id}.png` });
                this.ctx.logger.info(`图片资源创建成功, Asset ID: ${assetId}`);
                return Success(assetId);
            } else {
                // 处理 API 返回的失败状态
                throw new Error(`任务失败，API 返回状态码: ${finalTask.code}`);
            }
        } catch (error) {
            if (error instanceof ApiError) {
                this.ctx.logger.error(`API 请求失败 (Status: ${error.status}): ${error.message}. 响应体: %o`, error.body);
                return Failed(`API 请求失败: ${error.message}`);
            } else if (error instanceof Error) {
                this.ctx.logger.error(`任务执行出错: ${error.message}\n%s`, error.stack);
                return Failed(`任务执行失败: ${error.message}`);
            } else {
                this.ctx.logger.error("发生未知错误: %o", error);
                return Failed("发生未知错误，请检查控制台日志");
            }
        } finally {
            this.ctx.logger.info(`--- 任务流程结束, 总耗时: ${totalTimer.stop()} ---`);
        }
    }

    private async fetchWithHandling(url: string, options: RequestInit = {}): Promise<Response> {
        this.ctx.logger.debug(`发起请求: ${options.method || "GET"} ${url}`);
        const response = await fetch(url, options);

        if (!response.ok) {
            let errorBody;
            try {
                errorBody = await response.json();
            } catch {
                errorBody = await response.text();
            }
            throw new ApiError(response.status, errorBody, `HTTP error! Status: ${response.status}`);
        }
        return response;
    }

    private async getPublicKey(): Promise<string> {
        this.ctx.logger.debug("获取公钥...");
        const response = await this.fetchWithHandling(`${this.config.endpoint}/v1/access/pub`);
        const data = await response.json();
        return Buffer.from(data.pub, "base64").toString("utf8");
    }

    private encrypt(plaintext: string, publicKeyPem: string): string {
        try {
            return crypto
                .publicEncrypt({ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(plaintext, "utf8"))
                .toString("base64");
        } catch (error) {
            this.ctx.logger.error("使用公钥加密失败: %o", error);
            throw new Error("Encryption failed", { cause: error });
        }
    }

    private async getSecret(token: string): Promise<string> {
        const publicKey = await this.getPublicKey();
        const salt = JSON.stringify({ timestamp: Date.now(), randomString: token });
        return this.encrypt(salt, publicKey);
    }

    private async submitTask(args: GenerateArgs, secret: string): Promise<GenerateResult> {
        this.ctx.logger.debug("向 API 提交 txt2img 任务...");
        const response = await this.fetchWithHandling(`${this.config.endpoint}/v2/generate/txt2img?token=${this.config.token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ args, secret }),
        });
        return response.json();
    }

    private async getTaskResult(taskId: string): Promise<TaskResult> {
        const response = await this.fetchWithHandling(`${this.config.endpoint}/v2/generate/task/${taskId}`);
        return response.json();
    }
}
