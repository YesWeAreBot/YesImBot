# 模型提供商与接入协议

提供商决定 API 地址预设和可用接口；接入协议决定请求和响应的格式。模型名称相同，不代表不同接入协议支持的能力完全一致。

## 选择协议

| 提供商         | 可选协议                    | API 地址示例                                                                                                                |
| -------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Google Gemini  | OpenAI 兼容、Gemini 原生    | 兼容：`https://generativelanguage.googleapis.com/v1beta/openai/`；原生：`https://generativelanguage.googleapis.com/v1beta/` |
| Anthropic      | OpenAI 兼容、Anthropic 原生 | `https://api.anthropic.com/v1/`                                                                                             |
| 其他现有提供商 | 保留原有接入方式            | 使用相应提供商的预设或自定义地址                                                                                            |

未选择协议的已有配置继续使用原有兼容方式。切换协议时，请同时核对 API 地址；已有自定义地址不会被自动覆盖。中转服务必须支持所选协议，不能仅凭其提供 Gemini 或 Claude 模型就选择原生。

原生接入沿用模型组、超时、代理、故障转移和回复内容验证。它不意味着所有服务商扩展参数及所有多模态功能均已支持。OpenAI Responses、Ollama 原生接口及 Qwen 原生接口暂不受原生模式支持。

## 原生模式支持范围

| 能力                             | Gemini 原生            | Anthropic 原生                      |
| -------------------------------- | ---------------------- | ----------------------------------- |
| 普通、流式对话                   | 支持                   | 支持                                |
| 函数工具与工具结果               | 支持，保留续接所需签名 | 支持，保留续接所需原生内容块        |
| 图片输入                         | base64 data URL        | base64 data URL 或 HTTP(S) 图片 URL |
| 嵌入                             | 单条、批量文本         | 不提供                              |
| 服务商内置搜索、音视频、文件接口 | 暂不支持               | 暂不支持                            |

Gemini 的工具结果目前限于文本，不接受图片或音频结果；Anthropic 的工具结果支持文本和图片，音频结果会明确报错。

不支持的参数会明确报错，不会自动切换到兼容协议。Gemini 原生不支持函数工具的 `strict: true`；结构化回复可使用其 JSON 输出配置。Anthropic 原生的结构化输出使用 `output_config`，不接受 OpenAI 的 `response_format`。

Anthropic 原生模式不自动填入温度和 top-p，请根据具体模型要求设置。若从旧配置切换，检查已有采样参数，不要同时填写温度和 top-p；部分模型需要两项均留空。未指定输出上限时，原生 Anthropic 请求采用 `max_tokens: 4096`，可通过模型自定义参数调整。

## 其他提供商设置

- Workers AI 需要 API Token 和 Cloudflare 账户 ID；请求地址由账户 ID 构造，不提供无效的自定义地址输入。
- LM Studio 的新配置默认使用 `http://localhost:1234/v1/`。若本地服务使用其他端口，填写其实际地址。
- MiniMax 的新配置区分国内 `https://api.minimax.cn/v1/` 和国际 `https://api.minimax.io/v1/`。订阅套餐请以服务商说明为准，勿混用不同套餐的密钥和地址。
- 混元的 OpenAI 兼容接口使用混元 API Key，不使用通用云 API 的 SecretId/SecretKey。
- Featherless AI 使用正确的名称；已有 `Fatherless AI` 配置名称仍可读取。

已填写的旧地址会保留。如果之前没有填写地址，将使用更新后的默认地址；如需继续使用旧地址，请将其填写到 API 地址中。

## 参考

- [Gemini OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)
- [Anthropic OpenAI 兼容接口](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
- [MiniMax 国内 OpenAI 兼容接口](https://platform.minimaxi.com/docs/api-reference/text-chat)
- [MiniMax 国际接入说明](https://platform.minimax.io/docs/guides/quickstart-preparation)
- [LM Studio 默认端口](https://lmstudio.ai/docs/developer/rest/quickstart)
- [混元 OpenAI 兼容接口与密钥](https://cloud.tencent.com/document/product/1729/111007)
