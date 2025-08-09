[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / cosineSimilarity

# Function: cosineSimilarity()

> **cosineSimilarity**(`vecA`, `vecB`): `number`

Defined in: [packages/core/src/shared/utils/vector.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/shared/utils/vector.ts#L44)

计算两个向量之间的余弦相似度。
返回值范围为 -1 到 1，值越接近 1 表示两个向量越相似。

## Parameters

### vecA

`number`[]

向量 A (number[]).

### vecB

`number`[]

向量 B (number[]).

## Returns

`number`

两个向量的余弦相似度。

## Throws

如果向量长度不一致，则抛出错误。
