[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / hashString

# Function: hashString()

> **hashString**(`str`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:136](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/shared/utils/string.ts#L136)

生成字符串的简单哈希值（32位整数的 base-36 表示）。

## Parameters

### str

`string`

输入字符串。

## Returns

`string`

一个简短的哈希字符串。

## Warning

此哈希函数非常简单，**不具有密码学安全性**，仅适用于非安全场景，如数据分桶、生成唯一键等。
