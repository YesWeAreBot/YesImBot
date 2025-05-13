import { Schema } from "koishi";
import { Config as AdapterConfig } from "./adapters/config";
import { EmbeddingConfig } from "./embeddings/config";

export interface Config {
    MemorySlot: {
        SlotContains: string[];
        SlotSize: number;
        AtReactPossibility?: number;
        IncreaseWillingnessOn: {
            Message: number;
            At: number;
        }
        Threshold: number;
        StoreFile: Record<string, string>;
    };
    API: AdapterConfig;
    Bot: {
        WordsPerSecond: number;
    };
    Embedding: EmbeddingConfig;
    ImageViewer: {};
    Settings: {};
    Debug: {
        EnableDebug: boolean;
        TestMode: boolean;
    };
}

export const Config: Schema<Config> = Schema.object({
    // TODO: 给每个记忆槽位单独的设置
    MemorySlot: Schema.object({
        SlotContains: Schema.array(String)
            .required()
            .role("table")
            .description("记忆槽位"),
        SlotSize: Schema.number()
            .default(20)
            .min(1)
            .description("Bot 接收的上下文数量（消息队列最大长度）"),
        AtReactPossibility: Schema.number()
            .default(0.5)
            .min(0)
            .max(1)
            .step(0.05)
            .role("slider")
            .description("立即回复 @ 消息的概率"),
        IncreaseWillingnessOn: Schema.object({
            Message: Schema.number()
                .default(15)
                .min(0)
                .max(100)
                .description("收到消息时增加的意愿值"),
            At: Schema.number()
                .default(80)
                .min(0)
                .max(100)
                .description("收到 @ 消息时增加的意愿值")
        }),
        Threshold: Schema.number()
            .min(0)
            .max(100)
            .default(80)
            .step(1)
            .role("slider")
            .description("回复意愿阈值"),
        StoreFile: Schema.dict(
            String,
            Schema.path({ allowCreate: true, filters: ['directory', { name: 'text', extensions: ['txt'] }] }).required(),
        )
            .role("table")
            .default({
                "human": "data/yesimbot/memory/human.txt",
                "persona": "data/yesimbot/memory/persona.txt"
            })
            .description("要绑定的记忆文件")
    }).description("记忆槽位设置"),
    API: AdapterConfig,
    Bot: Schema.object({
        WordsPerSecond: Schema.number()
            .min(0)
            .max(360)
            .default(20)
            .step(1)
            .role("slider")
            .description("每秒发送的字符数")
    }).description("机器人设定"),

    // 保留备用。记忆方案：["embedding模型与RAG，结合koishi的database做向量库", "定期发送消息给LLM，总结聊天记录，并塞到后续的请求prompt中", "两者结合，定期发送消息给LLM，总结聊天记录，把总结文本向量化后存入向量库，有请求时把输入向量化和向量库内的总结做比对，提取出相关的总结塞到prompt中"]
    // 向量库的设想：为每个向量添加时间戳，定期检查并删除超过一定时间的向量；记录每个向量的使用频率，删除使用频率低的向量；查询时，提升更近时间存入的向量的权重 // 遗忘机制 & 减少向量库的大小
    // 多模态向量库：图像和文本嵌入模型，需要CLIP等多模态模型支持/文本和图像对齐??
    // 欸以上这些好像mem0都想到了?
    //
    // Memory: Schema.intersect([
    //     Schema.object({
    //         Enabled: Schema.boolean().default(false),
    //     }).description('是否启用记忆中枢'),
    //     Schema.union([
    //         Schema.object({
    //             Enabled: Schema.const(true).required(),
    //             API: Schema.object({
    //                 APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"])
    //                     .default("OpenAI")
    //                     .description("记忆中枢 API 类型"),
    //                 BaseURL: Schema.string()
    //                     .default("https://api.openai.com/")
    //                     .description("记忆中枢 API 基础 URL"),
    //                 UID: Schema.string()
    //                     .default("")
    //                     .description("记忆中枢 Cloudflare UID（如果适用）"),
    //                 APIKey: Schema.string()
    //                     .default("sk-xxxxxxx")
    //                     .description("记忆中枢 API 令牌"),
    //                 AIModel: Schema.string()
    //                     .default("gpt-3.5-turbo")
    //                     .description("记忆中枢使用的模型"),
    //             }).description("记忆中枢 API 配置"),
    //         }),
    //     ])
    // ]),

    Embedding: EmbeddingConfig,

    ImageViewer: Schema.object({}),

    Settings: Schema.object({}),

    Debug: Schema.object({
        EnableDebug: Schema.boolean()
            .default(false)
            .description("在控制台显示 Debug 消息"),
        TestMode: Schema.boolean()
            .default(false)
            .description("测试模式。如果你不知道这是什么，不要开启"),
    }).description("调试设置"),
});
