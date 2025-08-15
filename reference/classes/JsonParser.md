[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / JsonParser

# Class: JsonParser\<T\>

Defined in: [packages/core/src/shared/utils/json-parser.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/shared/utils/json-parser.ts#L21)

## Type Parameters

### T

`T`

## Constructors

### Constructor

> **new JsonParser**\<`T`\>(`options`): `JsonParser`\<`T`\>

Defined in: [packages/core/src/shared/utils/json-parser.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/shared/utils/json-parser.ts#L25)

#### Parameters

##### options

[`ParserOptions`](../interfaces/ParserOptions.md) = `{}`

#### Returns

`JsonParser`\<`T`\>

## Methods

### parse()

> **parse**(`rawOutput`): [`ParseResult`](../interfaces/ParseResult.md)\<`T`\>

Defined in: [packages/core/src/shared/utils/json-parser.ts:39](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/shared/utils/json-parser.ts#L39)

#### Parameters

##### rawOutput

`string`

#### Returns

[`ParseResult`](../interfaces/ParseResult.md)\<`T`\>
