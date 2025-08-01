[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / formatSize

# Function: formatSize()

> **formatSize**(`bytes`, `decimals`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/shared/utils/string.ts#L37)

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
