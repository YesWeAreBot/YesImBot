[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / randomString

# Function: randomString()

> **randomString**(`length`): `string`

Defined in: [packages/core/src/shared/utils/string.ts:56](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/shared/utils/string.ts#L56)

生成指定长度的随机字符串（仅包含大小写字母和数字）。

## Parameters

### length

`number`

期望的字符串长度。

## Returns

`string`

生成的随机字符串。

## Warning

此函数生成的字符串**不具有密码学安全性**，请勿用于密码、令牌等敏感场景。
