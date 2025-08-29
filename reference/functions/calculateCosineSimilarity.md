[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / calculateCosineSimilarity

# Function: calculateCosineSimilarity()

> **calculateCosineSimilarity**(`vec1`, `vec2`): `number`

Defined in: [packages/core/src/services/model/embed-model.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/embed-model.ts#L52)

Calculates the cosine similarity between two vectors.
The similarity is normalized to a [0, 1] range.

## Parameters

### vec1

`number`[]

The first vector.

### vec2

`number`[]

The second vector.

## Returns

`number`

A similarity score between 0 (not similar) and 1 (identical).
