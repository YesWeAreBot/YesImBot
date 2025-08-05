[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / handleError

# Function: handleError()

> **handleError**(`logger`, `error`, `contextDescription`): `string`

Defined in: [packages/core/src/shared/errors/index.ts:215](https://github.com/YesWeAreBot/YesImBot/blob/fb48ed04032f4b5a158b252aad13c4c7a3ffb363/packages/core/src/shared/errors/index.ts#L215)

统一错误处理函数
实现了分层日志记录和可选的错误自动上报功能

## Parameters

### logger

`__module`

Koishi 的 Logger 实例，用于记录日志

### error

`unknown`

捕获到的未知类型的错误

### contextDescription

`string`

描述错误发生时的操作或环节，例如 "处理聊天请求"

## Returns

`string`

返回生成的唯一错误 ID
