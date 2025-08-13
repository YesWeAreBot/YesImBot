[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ErrorDefinitions

# Variable: ErrorDefinitions

> `const` **ErrorDefinitions**: `object`

Defined in: [packages/core/src/shared/errors/definitions.ts:6](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/shared/errors/definitions.ts#L6)

## Type declaration

### CONFIG

> `readonly` **CONFIG**: `object`

#### CONFIG.INVALID

> `readonly` **INVALID**: `object`

#### CONFIG.INVALID.code

> `readonly` **code**: `"CONFIG.INVALID"` = `"CONFIG.INVALID"`

#### CONFIG.INVALID.message()

> `readonly` **message**: (`details`) => `string`

##### Parameters

###### details

`string`

##### Returns

`string`

#### CONFIG.INVALID.suggestion

> `readonly` **suggestion**: `"请检查插件配置并更正指定的字段。有关有效值，请参阅文档"` = `"请检查插件配置并更正指定的字段。有关有效值，请参阅文档"`

#### CONFIG.MISSING

> `readonly` **MISSING**: `object`

#### CONFIG.MISSING.code

> `readonly` **code**: `"CONFIG.MISSING"` = `"CONFIG.MISSING"`

#### CONFIG.MISSING.message()

> `readonly` **message**: (`service`, `component`) => `string`

##### Parameters

###### service

`string`

###### component

`string`

##### Returns

`string`

#### CONFIG.MISSING.suggestion()

> `readonly` **suggestion**: (`component`) => `string`

##### Parameters

###### component

`string`

##### Returns

`string`

#### CONFIG.MISSING\_MODEL\_GROUP

> `readonly` **MISSING\_MODEL\_GROUP**: `object`

#### CONFIG.MISSING\_MODEL\_GROUP.code

> `readonly` **code**: `"CONFIG.MISSING_MODEL_GROUP"` = `"CONFIG.MISSING_MODEL_GROUP"`

#### CONFIG.MISSING\_MODEL\_GROUP.message

> `readonly` **message**: `"未给 '聊天 (Chat)' 任务类型配置任何模型组"` = `"未给 '聊天 (Chat)' 任务类型配置任何模型组"`

#### CONFIG.MISSING\_MODEL\_GROUP.suggestion

> `readonly` **suggestion**: `"代理需要一个聊天模型才能运作。请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型"` = `"代理需要一个聊天模型才能运作。请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型"`

#### CONFIG.PROVIDER\_INIT\_FAILED

> `readonly` **PROVIDER\_INIT\_FAILED**: `object`

#### CONFIG.PROVIDER\_INIT\_FAILED.code

> `readonly` **code**: `"CONFIG.PROVIDER_INIT_FAILED"` = `"CONFIG.PROVIDER_INIT_FAILED"`

#### CONFIG.PROVIDER\_INIT\_FAILED.message()

> `readonly` **message**: (`providerId`) => `string`

##### Parameters

###### providerId

`string`

##### Returns

`string`

#### CONFIG.PROVIDER\_INIT\_FAILED.suggestion

> `readonly` **suggestion**: `"请确保提供商的配置（如 API 密钥和基础 URL）正确无误，并检查日志中是否有相关的错误信息"` = `"请确保提供商的配置（如 API 密钥和基础 URL）正确无误，并检查日志中是否有相关的错误信息"`

### LLM

> `readonly` **LLM**: `object`

#### LLM.BAD\_REQUEST

> `readonly` **BAD\_REQUEST**: `object`

#### LLM.BAD\_REQUEST.code

> `readonly` **code**: `"LLM.BAD_REQUEST"` = `"LLM.BAD_REQUEST"`

#### LLM.BAD\_REQUEST.message

> `readonly` **message**: `"LLM API 请求因格式错误而失败"` = `"LLM API 请求因格式错误而失败"`

#### LLM.BAD\_REQUEST.suggestion

> `readonly` **suggestion**: `"请检查您的请求参数，确保它们符合 API 的要求并已正确格式化"` = `"请检查您的请求参数，确保它们符合 API 的要求并已正确格式化"`

#### LLM.INVALID\_API\_KEY

> `readonly` **INVALID\_API\_KEY**: `object`

#### LLM.INVALID\_API\_KEY.code

> `readonly` **code**: `"LLM.INVALID_API_KEY"` = `"LLM.INVALID_API_KEY"`

#### LLM.INVALID\_API\_KEY.message

> `readonly` **message**: `"提供了无效的 LLM API 密钥"` = `"提供了无效的 LLM API 密钥"`

#### LLM.INVALID\_API\_KEY.suggestion

> `readonly` **suggestion**: `"请仔细检查您的 API 密钥，确保其在插件配置中已正确设置。如果您使用的是云服务，请确保您有权访问指定的模型"` = `"请仔细检查您的 API 密钥，确保其在插件配置中已正确设置。如果您使用的是云服务，请确保您有权访问指定的模型"`

#### LLM.OUTPUT\_PARSING\_FAILED

> `readonly` **OUTPUT\_PARSING\_FAILED**: `object`

#### LLM.OUTPUT\_PARSING\_FAILED.code

> `readonly` **code**: `"LLM.OUTPUT_PARSING_FAILED"` = `"LLM.OUTPUT_PARSING_FAILED"`

#### LLM.OUTPUT\_PARSING\_FAILED.message

> `readonly` **message**: `"解析 LLM 响应失败，输出不是有效的 JSON 格式"` = `"解析 LLM 响应失败，输出不是有效的 JSON 格式"`

#### LLM.OUTPUT\_PARSING\_FAILED.suggestion

> `readonly` **suggestion**: `"这通常是暂时的模型问题，请重试。如果问题持续存在，可能是模型不稳定或系统提示词需要调整以确保生成有效的 JSON"` = `"这通常是暂时的模型问题，请重试。如果问题持续存在，可能是模型不稳定或系统提示词需要调整以确保生成有效的 JSON"`

#### LLM.PROVIDER\_ERROR

> `readonly` **PROVIDER\_ERROR**: `object`

#### LLM.PROVIDER\_ERROR.code

> `readonly` **code**: `"LLM.PROVIDER_ERROR"` = `"LLM.PROVIDER_ERROR"`

#### LLM.PROVIDER\_ERROR.message

> `readonly` **message**: `"LLM 服务提供商内部发生错误"` = `"LLM 服务提供商内部发生错误"`

#### LLM.PROVIDER\_ERROR.suggestion

> `readonly` **suggestion**: `"请检查服务商的文档以确保其设置正确。如果问题仍然存在，请考虑报告此问题"` = `"请检查服务商的文档以确保其设置正确。如果问题仍然存在，请考虑报告此问题"`

#### LLM.RATE\_LIMIT\_EXCEEDED

> `readonly` **RATE\_LIMIT\_EXCEEDED**: `object`

#### LLM.RATE\_LIMIT\_EXCEEDED.code

> `readonly` **code**: `"LLM.RATE_LIMIT_EXCEEDED"` = `"LLM.RATE_LIMIT_EXCEEDED"`

#### LLM.RATE\_LIMIT\_EXCEEDED.message

> `readonly` **message**: `"LLM API 的请求频率超限"` = `"LLM API 的请求频率超限"`

#### LLM.RATE\_LIMIT\_EXCEEDED.suggestion

> `readonly` **suggestion**: `"请稍等片刻再发起请求。如果您使用的是云服务，请考虑升级您的套餐或将请求分散在更长的时间段内"` = `"请稍等片刻再发起请求。如果您使用的是云服务，请考虑升级您的套餐或将请求分散在更长的时间段内"`

#### LLM.REQUEST\_FAILED

> `readonly` **REQUEST\_FAILED**: `object`

#### LLM.REQUEST\_FAILED.code

> `readonly` **code**: `"LLM.REQUEST_FAILED"` = `"LLM.REQUEST_FAILED"`

#### LLM.REQUEST\_FAILED.message()

> `readonly` **message**: (`details`) => `string`

##### Parameters

###### details

`string`

##### Returns

`string`

#### LLM.REQUEST\_FAILED.suggestion

> `readonly` **suggestion**: `"请检查您的网络、API 密钥以及模型提供商的状态页面。这可能是由于频率限制、密钥无效或暂时的服务中断所致"` = `"请检查您的网络、API 密钥以及模型提供商的状态页面。这可能是由于频率限制、密钥无效或暂时的服务中断所致"`

#### LLM.TIMEOUT

> `readonly` **TIMEOUT**: `object`

#### LLM.TIMEOUT.code

> `readonly` **code**: `"LLM.TIMEOUT"` = `"LLM.TIMEOUT"`

#### LLM.TIMEOUT.message()

> `readonly` **message**: (`duration`) => `string`

##### Parameters

###### duration

`number`

##### Returns

`string`

#### LLM.TIMEOUT.suggestion

> `readonly` **suggestion**: `"模型响应时间过长。这可能是模型服务提供商的临时问题。如果此问题频繁发生，您可以尝试在模型设置中调高‘总超时’时间"` = `"模型响应时间过长。这可能是模型服务提供商的临时问题。如果此问题频繁发生，您可以尝试在模型设置中调高‘总超时’时间"`

### MEMORY

> `readonly` **MEMORY**: `object`

#### MEMORY.EMBEDDING\_FAILED

> `readonly` **EMBEDDING\_FAILED**: `object`

#### MEMORY.EMBEDDING\_FAILED.code

> `readonly` **code**: `"MEMORY.EMBEDDING_FAILED"` = `"MEMORY.EMBEDDING_FAILED"`

#### MEMORY.EMBEDDING\_FAILED.message

> `readonly` **message**: `"为记忆生成嵌入向量失败"` = `"为记忆生成嵌入向量失败"`

#### MEMORY.EMBEDDING\_FAILED.suggestion

> `readonly` **suggestion**: `"这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题"` = `"这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题"`

#### MEMORY.PROVIDER\_ERROR

> `readonly` **PROVIDER\_ERROR**: `object`

#### MEMORY.PROVIDER\_ERROR.code

> `readonly` **code**: `"MEMORY.PROVIDER_ERROR"` = `"MEMORY.PROVIDER_ERROR"`

#### MEMORY.PROVIDER\_ERROR.message

> `readonly` **message**: `"记忆提供商发生错误"` = `"记忆提供商发生错误"`

#### MEMORY.PROVIDER\_ERROR.suggestion

> `readonly` **suggestion**: `"请检查记忆提供商的配置并确保其设置正确。如果问题仍然存在，请考虑报告此问题"` = `"请检查记忆提供商的配置并确保其设置正确。如果问题仍然存在，请考虑报告此问题"`

#### MEMORY.SEARCH\_FAILED

> `readonly` **SEARCH\_FAILED**: `object`

#### MEMORY.SEARCH\_FAILED.code

> `readonly` **code**: `"MEMORY.SEARCH_FAILED"` = `"MEMORY.SEARCH_FAILED"`

#### MEMORY.SEARCH\_FAILED.message

> `readonly` **message**: `"搜索记忆失败"` = `"搜索记忆失败"`

#### MEMORY.SEARCH\_FAILED.suggestion

> `readonly` **suggestion**: `"这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题"` = `"这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题"`

### MODEL

> `readonly` **MODEL**: `object`

#### MODEL.ALL\_FAILED\_IN\_GROUP

> `readonly` **ALL\_FAILED\_IN\_GROUP**: `object`

#### MODEL.ALL\_FAILED\_IN\_GROUP.code

> `readonly` **code**: `"MODEL.ALL_FAILED_IN_GROUP"` = `"MODEL.ALL_FAILED_IN_GROUP"`

#### MODEL.ALL\_FAILED\_IN\_GROUP.message()

> `readonly` **message**: (`groupName`) => `string`

##### Parameters

###### groupName

`string`

##### Returns

`string`

#### MODEL.ALL\_FAILED\_IN\_GROUP.suggestion

> `readonly` **suggestion**: `"这表明存在普遍性问题。请检查错误报告中的 'cause' 以了解单个模型的失败原因。这可能是网络问题或影响组内所有模型的问题"` = `"这表明存在普遍性问题。请检查错误报告中的 'cause' 以了解单个模型的失败原因。这可能是网络问题或影响组内所有模型的问题"`

#### MODEL.GROUP\_INIT\_FAILED

> `readonly` **GROUP\_INIT\_FAILED**: `object`

#### MODEL.GROUP\_INIT\_FAILED.code

> `readonly` **code**: `"MODEL.GROUP_INIT_FAILED"` = `"MODEL.GROUP_INIT_FAILED"`

#### MODEL.GROUP\_INIT\_FAILED.message()

> `readonly` **message**: (`groupName`) => `string`

##### Parameters

###### groupName

`string`

##### Returns

`string`

#### MODEL.GROUP\_INIT\_FAILED.suggestion

> `readonly` **suggestion**: `"请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）"` = `"请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）"`

#### MODEL.NO\_SUITABLE\_MODEL

> `readonly` **NO\_SUITABLE\_MODEL**: `object`

#### MODEL.NO\_SUITABLE\_MODEL.code

> `readonly` **code**: `"MODEL.NO_SUITABLE_MODEL"` = `"MODEL.NO_SUITABLE_MODEL"`

#### MODEL.NO\_SUITABLE\_MODEL.message()

> `readonly` **message**: (`groupName`) => `string`

##### Parameters

###### groupName

`string`

##### Returns

`string`

#### MODEL.NO\_SUITABLE\_MODEL.suggestion

> `readonly` **suggestion**: `"请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）"` = `"请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）"`

#### MODEL.RETRY\_EXHAUSTED

> `readonly` **RETRY\_EXHAUSTED**: `object`

#### MODEL.RETRY\_EXHAUSTED.code

> `readonly` **code**: `"MODEL.RETRY_EXHAUSTED"` = `"MODEL.RETRY_EXHAUSTED"`

#### MODEL.RETRY\_EXHAUSTED.message()

> `readonly` **message**: (`modelId`) => `string`

##### Parameters

###### modelId

`string`

##### Returns

`string`

#### MODEL.RETRY\_EXHAUSTED.suggestion

> `readonly` **suggestion**: `"该模型反复失败。请检查错误日志以找出根本原因（例如，网络问题、持续的 API 错误）"` = `"该模型反复失败。请检查错误日志以找出根本原因（例如，网络问题、持续的 API 错误）"`

#### MODEL.UNAVAILABLE

> `readonly` **UNAVAILABLE**: `object`

#### MODEL.UNAVAILABLE.code

> `readonly` **code**: `"MODEL.UNAVAILABLE"` = `"MODEL.UNAVAILABLE"`

#### MODEL.UNAVAILABLE.message()

> `readonly` **message**: (`modelId`) => `string`

##### Parameters

###### modelId

`string`

##### Returns

`string`

#### MODEL.UNAVAILABLE.suggestion

> `readonly` **suggestion**: `"请验证模型 ID 是否正确，以及对应的提供商是否已启用并正确配置"` = `"请验证模型 ID 是否正确，以及对应的提供商是否已启用并正确配置"`

### NETWORK

> `readonly` **NETWORK**: `object`

#### NETWORK.REQUEST\_FAILED

> `readonly` **REQUEST\_FAILED**: `object`

#### NETWORK.REQUEST\_FAILED.code

> `readonly` **code**: `"NETWORK.REQUEST_FAILED"` = `"NETWORK.REQUEST_FAILED"`

#### NETWORK.REQUEST\_FAILED.message

> `readonly` **message**: `"网络请求失败"` = `"网络请求失败"`

#### NETWORK.REQUEST\_FAILED.suggestion

> `readonly` **suggestion**: `"请检查您服务器的互联网连接和 DNS 设置。如果您正在使用代理，请确保其配置正确且正在运行"` = `"请检查您服务器的互联网连接和 DNS 设置。如果您正在使用代理，请确保其配置正确且正在运行"`

### SYSTEM

> `readonly` **SYSTEM**: `object`

#### SYSTEM.UNKNOWN

> `readonly` **UNKNOWN**: `object`

#### SYSTEM.UNKNOWN.code

> `readonly` **code**: `"SYSTEM.UNKNOWN"` = `"SYSTEM.UNKNOWN"`

#### SYSTEM.UNKNOWN.message

> `readonly` **message**: `"发生未知错误"` = `"发生未知错误"`

#### SYSTEM.UNKNOWN.suggestion

> `readonly` **suggestion**: `"捕获到意外错误。请检查日志并考虑报告此问题"` = `"捕获到意外错误。请检查日志并考虑报告此问题"`

### TASK

> `readonly` **TASK**: `object`

#### TASK.EXECUTION\_FAILED

> `readonly` **EXECUTION\_FAILED**: `object`

#### TASK.EXECUTION\_FAILED.code

> `readonly` **code**: `"TASK.EXECUTION_FAILED"` = `"TASK.EXECUTION_FAILED"`

#### TASK.EXECUTION\_FAILED.message

> `readonly` **message**: `"执行计划任务时发生错误"` = `"执行计划任务时发生错误"`

#### TASK.EXECUTION\_FAILED.suggestion

> `readonly` **suggestion**: `"这表明代理的处理周期内存在内部错误。请检查详细日志以获取更多信息"` = `"这表明代理的处理周期内存在内部错误。请检查详细日志以获取更多信息"`

### WILLINGNESS

> `readonly` **WILLINGNESS**: `object`

#### WILLINGNESS.CALCULATION\_FAILED

> `readonly` **CALCULATION\_FAILED**: `object`

#### WILLINGNESS.CALCULATION\_FAILED.code

> `readonly` **code**: `"WILLINGNESS.CALCULATION_FAILED"` = `"WILLINGNESS.CALCULATION_FAILED"`

#### WILLINGNESS.CALCULATION\_FAILED.message

> `readonly` **message**: `"意愿计算失败"` = `"意愿计算失败"`

#### WILLINGNESS.CALCULATION\_FAILED.suggestion

> `readonly` **suggestion**: `"在决定是否回复时发生内部错误。请检查日志以获取更多详情"` = `"在决定是否回复时发生内部错误。请检查日志以获取更多详情"`

## Description

应用程序的统一错误定义
每个定义都包含 code (错误码)、message (错误信息) 和给用户的 suggestion (建议)
这种结构使错误处理更具声明性且保持一致
