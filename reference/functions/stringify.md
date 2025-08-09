[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / stringify

# Function: stringify()

> **stringify**(`obj`, `space?`, `fallback?`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:88](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/shared/utils/string.ts#L88)

将任何类型的对象安全地转换为字符串。
如果输入是字符串，则直接返回；否则，使用 JSON.stringify 进行转换。

## Parameters

### obj

`any`

要转换的对象。

### space?

`number`

### fallback?

`string` = `""`

当 JSON.stringify 失败时（例如循环引用）返回的备用值。

## Returns

`string`

转换后的字符串。
