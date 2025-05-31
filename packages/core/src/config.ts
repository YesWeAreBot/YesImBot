import { Computed, Schema } from "koishi";
import { ModelSetting, Provider } from "./adapters/config";

// 主配置接口
export interface Config {
    // Memory : {
    //     Scenario: {Identifier: string} []
    // }
    MemorySlot: {
        SlotContains: string[][];
        SlotSize: number;
        AtReactPossibility?: number | Computed<number>;
        IncreaseWillingnessOn: {
            Message: number;
            At: number;
        };
        Threshold: number;
        MessageWaitTime: number;
        SameUserThreshold: number;
        StoreFile: Record<string, string>;
    };
    Provider: Provider[];
    ModelSetting: ModelSetting;
    Chat: {
        UseModel: Array<Array<number>>;
        MaxHeartbeat: number;
        WordsPerSecond: number;
    };
    ToolCall: {
        MaxRetry: number;
        Life: number;
    };
    Debug: {
        EnableDebug: boolean;
        UploadDump: boolean;
        TestMode: boolean;
    };
}

// 主配置 Schema
export const Config: Schema<Config> = Schema.object({
    // Memory: Schema.object({
    //     Scenario: Schema.array(Schema.object({
    //         Identifier: Schema.string().required().description("场景标识符"),
    //     })).role("table").description("场景配置"),
    // }),
    MemorySlot: Schema.object({
        SlotContains: Schema.array(Schema.array(String).role("table")).description("记忆槽位标识符列表，用于区分不同的对话上下文"),
        SlotSize: Schema.number().default(20).min(1).max(100).description("每个记忆槽位保存的最大消息数量"),
        AtReactPossibility: Schema.computed(
            Schema.number().default(0.5).min(0).max(1).step(0.05).role("slider").description("收到 @ 消息时立即回复的概率（0-1）")
        ),
        IncreaseWillingnessOn: Schema.object({
            Message: Schema.number().default(15).min(0).max(100).description("收到普通消息时增加的回复意愿值"),
            At: Schema.number().default(80).min(0).max(100).description("收到 @ 消息时增加的回复意愿值"),
        }).description("不同消息类型对回复意愿的影响"),
        Threshold: Schema.number().min(0).max(100).default(80).step(1).role("slider").description("触发回复的意愿阈值"),
        MessageWaitTime: Schema.number().default(2000).min(0).max(10000).description("消息等待时间（毫秒），用于合并用户的连续消息"),
        SameUserThreshold: Schema.number().default(5000).min(0).max(30000).description("判定为同一用户连续消息的时间阈值（毫秒）"),
        StoreFile: Schema.dict(
            String,
            Schema.path({
                allowCreate: true,
                filters: ["directory", { name: "text", extensions: ["txt"] }],
            }).required()
        )
            .role("table")
            .default({
                human: "data/yesimbot/memory/human.txt",
                persona: "data/yesimbot/memory/persona.txt",
            })
            .description("记忆文件存储路径配置，键为记忆类型，值为文件路径"),
    }).description("记忆槽位管理配置"),
    Provider: Schema.array(Provider).required().description("模型服务"),
    ModelSetting: ModelSetting.description("模型设置"),
    Chat: Schema.object({
        UseModel: Schema.array(
            Schema.tuple([Schema.number().min(0), Schema.number().min(0)])
                .default([0, 0])
                .description("第几个提供商的第几个模型，从 0 开始计数")
        ).description("对话使用的模型"),
        MaxHeartbeat: Schema.number().min(1).max(6).default(2).step(1).role("slider").description("最大心跳次数，控制对话的活跃度"),
        WordsPerSecond: Schema.number().min(0).max(360).default(20).step(1).role("slider").description("模拟打字速度，每秒发送的字符数"),
    }).description("对话行为配置"),

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

    ToolCall: Schema.object({
        MaxRetry: Schema.number().default(3).min(0).max(10).description("工具调用失败时的最大重试次数"),
        Life: Schema.number().default(3).min(0).max(10).description("工具调用的生命周期次数"),
    }).description("工具调用管理配置"),

    Debug: Schema.object({
        EnableDebug: Schema.boolean().default(false).description("在控制台显示详细的调试信息"),
        UploadDump: Schema.boolean().default(false).description("应用出错时自动上报详细日志给开发者（包含聊天内容和 LLM 输出）"),
        TestMode: Schema.boolean().default(false).description("启用测试模式，用于开发和调试"),
    }).description("调试和诊断配置"),
});
