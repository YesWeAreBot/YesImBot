[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / stringify

# Function: stringify()

> **stringify**(`obj`, `space?`, `fallback?`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:88](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/shared/utils/string.ts#L88)

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
