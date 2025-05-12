import { Schema } from "koishi";
import { Config as AdapterConfig } from "./adapters/config";
import { EmbeddingConfig } from "./embeddings/config";

export interface Config {
    MemorySlot: {
        SlotContains: string[][];
        SlotSize: number;
        FirstTriggerCount: number;
        MaxTriggerCount: number;
        MinTriggerCount: number;
        MaxTriggerTime: number;
        MinTriggerTime: number;
        AtReactPossibility?: number;
        Filter: string[];
        StoreFile: Record<string, string>;
    };
    API: AdapterConfig;
    Bot: {};
    Embedding: EmbeddingConfig;
    ImageViewer: {};
    Settings: {};
    Debug: {};
}

export const Config: Schema<Config> = Schema.object({
    // TODO: 给每个记忆槽位单独的设置
    MemorySlot: Schema.object({
        SlotContains: Schema.array(Schema.array(Schema.string()).role("table"))
            .required()
            .role("table")
            .description("记忆槽位。填入一个或多个会话ID，每行一个。群聊的会话ID是群号，私聊的会话ID是\"private:\" + 用户账号。用\"all\"指定所有群聊，用\"private:all\"指定所有私聊。同一个槽位的聊天将共用同一份记忆。如果多个槽位都包含同一会话ID，第一个包含该会话ID的槽位将被应用"),
        SlotSize: Schema.number()
            .default(20)
            .min(1)
            .description("Bot 接收的上下文数量（消息队列最大长度）"),
        FirstTriggerCount: Schema.number()
            .default(3)
            .min(1)
            .description("Bot 开始回复消息的初始触发计数"),
        MaxTriggerCount: Schema.number()
            .default(10)
            .min(1)
            .description("Bot 两次回复之间的最大消息数"),
        MinTriggerCount: Schema.number()
            .default(1)
            .min(1)
            .description("Bot 两次回复之间的最小消息数"),
        MaxTriggerTime: Schema.number()
            .default(0)
            .min(0)
            .max(2147483)
            .description("Bot 能容忍冷场的最长时间（秒），距离会话最后一条消息达到此时间时，将主动触发一次Bot回复，设为 0 表示关闭此功能"),
        MinTriggerTime: Schema.number()
            .default(1000)
            .min(0)
            .description("Bot 单次触发冷却（毫秒），冷却期间如又触发回复，将处理新触发回复，跳过本次触发"),
        AtReactPossibility: Schema.number()
            .default(0.5)
            .min(0)
            .max(1)
            .step(0.05)
            .role("slider")
            .description("立即回复 @ 消息的概率"),
        Filter: Schema.array(Schema.string())
            .default(["你是", "You are", "吧", "呢"])
            .description("过滤的词汇（防止被调皮群友/机器人自己搞傻）可以使用正则表达式"),
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
    Bot: Schema.object({}).description("机器人设定"),

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

    ImageViewer: Schema.intersect([
        Schema.object({
            How: Schema.union([
                "LLM API 自带的多模态能力",
                "图片描述服务",
                "替换成[图片:summary]",
                "替换成[图片]",
                "不做处理，以<img>标签形式呈现",
            ])
                .default("替换成[图片]")
                .description("处理图片的方式。失败时会自动尝试后一种方式"),
        }).description("图片查看器"),
        Schema.union([
            Schema.object({
                How: Schema.const("LLM API 自带的多模态能力").required(),
                Memory: Schema.number()
                    .default(1)
                    .min(-1)
                    .description("使用 LLM API 自带的多模态能力时，LLM 真正能看到的最近的图片数量。设为-1取消此限制"),
            }),
            Schema.object({
                How: Schema.const("图片描述服务").required(),
                DescribeImmidately: Schema.boolean()
                    .default(false)
                    .description("是否在收到图片时立即描述图片"),
                Question: Schema.string()
                    .default("这张图里有什么？")
                    .description("图片描述服务针对输入图片的问题"),
                BaseURL: Schema.string()
                    .default("http://127.0.0.1")
                    .description("自己搭建的图片描述服务或另一个LLM的完整 URL"),
                APIKey: Schema.string().description("图片描述服务可能需要的 API 密钥，对于不同服务，它们的名称可能不同。例如`access_token`"),
                Server: Schema.intersect([
                    Schema.object({
                        Type: Schema.union(["百度AI开放平台", "自己搭建的服务", "另一个LLM"])
                            .required()
                            .default("百度AI开放平台")
                            .description("图片查看器使用的服务提供商"),
                    }),
                    Schema.union([
                        Schema.object({
                            Type: Schema.const("百度AI开放平台"),
                        }),
                        Schema.object({
                            Type: Schema.const("自己搭建的服务").required(),
                            RequestBody: Schema.string()
                                .role('textarea', { rows: [1, 4] })
                                .description("自己搭建的图片描述服务需要的请求体。<br/>其中：<br/>\
                  `<url>`(包含尖括号)会被替换成消息中出现的图片的url;<br/>\
                  `<base64>`(包含尖括号)会被替换成图片的base64(自带`data:image/jpeg;base64,`头，无需另行添加);<br/>\
                  `<question>`(包含尖括号)会被替换成此页面设置的针对输入图片的问题;<br/>\
                  `<apikey>`(包含尖括号)会被替换成此页面设置的图片描述服务可能需要的 API 密钥".trim()),
                            GetDescRegex: Schema.string().description("从自己搭建的图片描述服务提取所需信息的正则表达式。注意转义"),
                        }),
                        Schema.object({
                            Type: Schema.const("另一个LLM").required(),
                            Adapter: Schema.union([
                                "OpenAI",
                                "Custom URL",
                                "Ollama",
                                "Cloudflare"
                            ])
                                .default("OpenAI")
                                .description("使用另一个LLM时的适配器类型"),
                            Model: Schema.string()
                                .default("gpt-4o-mini")
                                .description("使用另一个LLM时的模型名称"),
                            Detail: Schema.union(["low", "high", "auto"])
                                .default("low")
                                .description("使用 LLM 时的图片处理细节，这关系到 Token 消耗"),
                        }),
                        Schema.object({}),
                    ]),
                ]),
            }),
            Schema.object({}),
        ]),
    ]),

    Settings: Schema.object({
        AgentMode: Schema.boolean().default(false).experimental().description("是否启用Agent模式"),
        SingleMessageStrctureTemplate: Schema.string()
            .default("[{{messageId}}][{{date}} {{channelInfo}}] {{senderName}}<{{senderId}}>: {{userContent}}")
            .description("单条消息的结构模板"),
        SendResolveOK: Schema.boolean()
            .default(true)
            .description("在 System Prompt 后发送 Assistant 的 'Resolve OK' 回复。"),
        LogicRedirect: Schema.intersect([
            Schema.object({
                Enabled: Schema.boolean()
                    .default(false)
                    .description("是否开启逻辑重定向"),
            }),
            Schema.union([
                Schema.object({
                    Enabled: Schema.const(true).required(),
                    Target: Schema.string()
                        .default("")
                        .description("将 Bot 的发言逻辑重定向到群组"),
                }),
                Schema.object({}),
            ]),
        ]),
        FirsttoAll: Schema.boolean()
            .default(false)
            .description("记忆槽位的行为改为：如果多个槽位都包含同一群号，所有包含该群号的槽位都将被应用"),
        SelfReport: Schema.array(
            Schema.union(["指令消息", "逻辑重定向", "和LLM交互的消息"])
        )
            .default(["和LLM交互的消息"])
            .role("checkbox")
            .description("选择将 Bot 的哪些消息添加到数据库"),
        UpdatePromptOnLoad: Schema.boolean()
            .default(true)
            .description("每次启动时尝试更新 Prompt 文件"),
        AllowErrorFormat: Schema.boolean()
            .default(false)
            .description("兼容几种较为常见的大模型错误输出格式"),
        MultiTurn: Schema.boolean()
            .default(true)
            .description("将历史消息以多轮对话格式传递给LLM"),
        AddRoleTagBeforeContent: Schema.boolean()
            .default(false)
            .description("在消息内容前添加发送者的角色标签，格式为[role]"),
        AssistantFormat: Schema.union([
            Schema.const("RAW").description("原始消息（完整JSON或者XML）"),
            Schema.const("CONTENT").description("消息内容（经单条消息模板处理的finalReply）"),
        ])
            .default("RAW")
            .description("在构建请求中的messages数组时，Bot历史消息的呈现格式"),
        RemoveTheseFromRAW: Schema.array(
            Schema.union([
                Schema.const("status").description("status: 状态信息，Athena能够处理的值有三种，为`success`、`skip`、`interaction`，其余值会被置为`fail`"),
                Schema.const("replyTo").description("replyTo: 消息发送的目的地，群聊的话就是群号，私聊的话就是带有`private:`的用户账号"),
                Schema.const("nextReplyIn").description("nextReplyIn: Bot 还需要收到这么多条消息才会看一眼聊天内容"),
                Schema.const("logic").description("logic: Bot 的思考逻辑，在上下文中，它可能引起复读问题，推荐勾选"),
                Schema.const("reply").description("reply: Bot 的初版回复，可能会引起复读问题，推荐勾选"),
                Schema.const("check").description("check: Bot 的对消息生成条例的检查结果，可能会引起复读问题，推荐勾选"),
                Schema.const("finalReply").description("finalReply: Bot 的最终回复，如果勾选了，Bot就不知道自己之前发的消息是什么啦，所以不要勾选哦"),
                Schema.const("functions").description("functions: Bot 的功能调用，勾不勾问题都不大"),
            ])
        )
            .role("checkbox")
            .default(["nextReplyIn", "logic", "reply", "check"])
            .description("从 Bot 的原始消息中移除这些字段的值"),
        SendAssistantMessageAs: Schema.union(["USER", "ASSISTANT"])
            .default("ASSISTANT")
            .description("在构建请求中的messages数组时，把 Bot 的历史消息或工具调用消息按照此角色呈现"),
        MergeConsecutiveMessages: Schema.boolean()
            .default(false)
            .description
            ("合并连续的USER或ASSISTANT消息。如果最后一条消息是ASSISTANT消息，在其后添加一条空的USER消息。某些模型可能需要开启此设置"),
        LLMResponseFormat: Schema.union([
            Schema.const("JSON").description("JSON 格式"),
            Schema.const("XML").description("XML 格式"),
        ]).default("XML").description("LLM 返回的消息格式。如勾选了“结构化输出”，消息格式将为“JSON”，此处设置将被忽略"),
    }).description("插件设置"),

    Debug: Schema.object({
        DebugAsInfo: Schema.boolean()
            .default(false)
            .description("在控制台显示 Debug 消息"),
        TestMode: Schema.boolean()
            .default(false)
            .description("测试模式。如果你不知道这是什么，不要开启"),
        IgnoreImgCache: Schema.boolean()
            .default(false)
            .description("忽略图片缓存"),
    }).description("调试设置"),
});
