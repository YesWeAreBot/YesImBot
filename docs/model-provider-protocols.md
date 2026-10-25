# 模型提供商与官方接口

选择提供商类型后，YIB 使用该提供商对应的官方接口，不另设“原生/兼容”协议开关。需要 OpenAI 兼容中转时，请选择 **OpenAI Compatible**，填写中转地址、密钥和模型 ID。

## 提供商对应的接口

| 提供商            | 对话接口                          | API 根地址示例                                      |
| ----------------- | --------------------------------- | --------------------------------------------------- |
| Google Gemini     | 原生 GenerateContent              | `https://generativelanguage.googleapis.com/v1beta/` |
| Anthropic         | 原生 Messages                     | `https://api.anthropic.com/v1/`                     |
| Qwen              | 原生 DashScope 文本或多模态生成   | `https://dashscope.aliyuncs.com/api/v1/`            |
| Ollama            | 原生 `/api/chat`，流式使用 NDJSON | `http://localhost:11434/`                           |
| Workers AI        | 原生 `/ai/run/{model}`            | 使用 Cloudflare 账户 ID 自动构造                    |
| LM Studio         | 原生 `/api/v1/chat`               | `http://localhost:1234/`                            |
| OpenAI Compatible | OpenAI Chat Completions 兼容接口  | 填写服务实际提供的完整版本根地址                    |

其他提供商保留其官方公开的现行接口。DeepSeek 等官方对话 API 本身就采用 Chat Completions 格式，格式相同不代表请求经过 OpenAI，也不需要人为改成另一套格式。不会自动切换到已废弃或将下线的旧专有接口。

OpenAI Responses、xAI Responses、Perplexity Agent/Orchestrator 等接口代际迁移涉及模型名称、状态和工具能力的变化，不等同于修复兼容端点，不会自动迁移已有模型。

## 从旧配置迁移

- Gemini 的 `/v1beta/openai/` 地址改为 `/v1beta/`；如需继续使用兼容接口，将提供商类型改为 OpenAI Compatible。
- Qwen 的 `/compatible-mode/v1/` 地址改为对应地域和账户的原生 `/api/v1/` 根地址。多模态模型需要声明“视觉”能力；其文本输入也会使用多模态生成接口。
- Ollama、LM Studio 使用服务根地址，去掉原兼容地址末尾的 `/v1/`。LM Studio 原生聊天需要支持 `/api/v1/chat` 的服务版本。
- Anthropic 地址仍为 `/v1/`，但请求改用 Messages。清理仅适用于兼容接口的自定义参数，并按具体模型要求设置采样参数。
- 自定义中转地址不会被自动重写；它必须支持所选提供商的原生接口。发现明确的兼容路径时会提示更换地址或提供商类型，不会悄悄降级到兼容协议。
- 旧的 `protocol` 配置字段不再决定请求格式，以提供商类型为准。

原生接入沿用模型组、超时、代理、故障转移、内容验证和用量统计。HTTP 原生协议与“原生工具调用”开关是两回事：使用 JSON 动作回复时，请求仍通过对应提供商的原生接口发送。

## 支持范围

| 提供商     | 支持范围与限制                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini     | 普通/流式对话、函数工具、base64 图片、单条/批量嵌入。工具结果限文本；暂不支持远程图片自动上传、音视频、Live API 及服务商内置工具。                                                                    |
| Anthropic  | 普通/流式对话、函数工具、HTTP(S)/base64 图片及图片工具结果。保留工具续接需要的签名与原生内容块。不提供嵌入。                                                                                          |
| Qwen       | 文本/视觉生成、流式、函数工具及原生文本嵌入；按模型声明的能力选择文本或多模态接口。未覆盖所有 DashScope 产品接口。                                                                                    |
| Ollama     | 原生对话、NDJSON 流式、文本/图片输入、函数工具、嵌入及模型列表。强制或指定工具通过完整回复校验实现，不向 Ollama 发送其不支持的选择参数。                                                              |
| Workers AI | 支持原生 `response/tool_calls` 结构的文本模型、稠密嵌入和模型列表；模型专有多模态格式及无法表达的工具历史明确报错。                                                                                   |
| LM Studio  | 当前单条用户输入、系统提示、base64 图片、流式和模型列表。不启用服务器集成工具，不承诺任意角色历史回放；YIB 使用 JSON 动作方式。嵌入沿用官方唯一公开的 `/v1/embeddings` 接口，未虚构独立原生嵌入端点。 |

不支持的参数和内容会明确报错，不会跨协议自动重试。被截断、拒绝或异常结束的工具响应不会交给工具执行器。

Anthropic 不自动填入温度和 top-p，不要同时填写两者；部分模型要求两项均留空。未指定输出上限时采用 `max_tokens: 4096`，可通过模型自定义参数调整。结构化输出使用 `output_config`，不接受 OpenAI 的 `response_format`。

## 其他设置

- Workers AI 需要 API Token 和 Cloudflare 账户 ID；请求地址由账户 ID 构造。
- MiniMax 的新配置区分国内 `https://api.minimax.cn/v1/` 和国际 `https://api.minimax.io/v1/`。订阅密钥与按量付费密钥、不同地域的密钥不可混用。
- 混元现行兼容接口使用混元 API Key，不使用通用云 API 的 SecretId/SecretKey。旧原生接口已进入下线流程，不作为新配置默认值。
- Featherless AI 使用正确名称；已有 `Fatherless AI` 配置仍可读取。
- 已填写的地址会保留；未填写时使用更新后的默认地址。旧地址可能需要按上述迁移说明调整。

## 参考

- [Gemini 原生 API](https://ai.google.dev/api/generate-content)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages)
- [Qwen DashScope](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope)
- [Ollama Chat](https://docs.ollama.com/api/chat)
- [Workers AI REST API](https://developers.cloudflare.com/workers-ai/configuration/rest-api/)
- [LM Studio 原生 REST API](https://lmstudio.ai/docs/developer/rest)
- [MiniMax 国内接口](https://platform.minimaxi.com/docs/api-reference/text-chat)
- [混元接口迁移说明](https://cloud.tencent.com/document/api/1729/105701)
