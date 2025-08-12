[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / hashString

# Function: hashString()

> **hashString**(`str`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:136](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/shared/utils/string.ts#L136)

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
