[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / truncate

# Function: truncate()

> **truncate**(`str`, `length`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:73](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/shared/utils/string.ts#L73)

截断长字符串以便于显示，并在末尾添加省略号。

## Parameters

### str

`string`

要截断的原始字符串。

### length

`number` = `80`

目标最大长度（不含省略号），默认为 80。

## Returns

`string`

截断后的字符串。
