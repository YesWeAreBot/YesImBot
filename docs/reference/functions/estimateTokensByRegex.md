[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / estimateTokensByRegex

# Function: estimateTokensByRegex()

> **estimateTokensByRegex**(`text`): `number`

Defined in: [packages/core/src/shared/utils/toolkit.ts:155](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/shared/utils/toolkit.ts#L155)

使用正则表达式估算文本的 token 数量（一种不依赖第三方库的近似方法）。
对长文本更内存友好。

## Parameters

### text

`string`

需要估算的文本。

## Returns

`number`

估算的 token 数量。
