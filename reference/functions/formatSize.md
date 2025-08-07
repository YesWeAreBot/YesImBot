[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / formatSize

# Function: formatSize()

> **formatSize**(`bytes`, `decimals`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/shared/utils/string.ts#L37)

将文件大小（字节）格式化为更易读的字符串。

## Parameters

### bytes

`number`

文件大小，单位为字节。

### decimals

`number` = `2`

保留的小数位数，默认为 2。

## Returns

`string`

格式化后的大小字符串，如 "1.23 MB"。
