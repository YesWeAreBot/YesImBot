[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StreamParser

# Class: StreamParser

Defined in: [packages/core/src/shared/utils/stream-parser.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L15)

通用流式解析器

## Constructors

### Constructor

> **new StreamParser**(`schema`): `StreamParser`

Defined in: [packages/core/src/shared/utils/stream-parser.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L25)

#### Parameters

##### schema

`Schema`

#### Returns

`StreamParser`

## Methods

### process()

> **process**(`stream`): `Promise`\<`void`\>

Defined in: [packages/core/src/shared/utils/stream-parser.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L78)

处理输入的字符串流，并根据 schema 将数据推送到对应的子流中

#### Parameters

##### stream

`AsyncGenerator`\<`string`\>

#### Returns

`Promise`\<`void`\>

***

### processText()

> **processText**(`text`, `final`): `void`

Defined in: [packages/core/src/shared/utils/stream-parser.ts:62](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L62)

#### Parameters

##### text

`string`

##### final

`boolean`

#### Returns

`void`

***

### reset()

> **reset**(): `void`

Defined in: [packages/core/src/shared/utils/stream-parser.ts:30](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L30)

#### Returns

`void`

***

### stream()

> **stream**\<`T`\>(`key`): `ReadableStream`\<`T`\>

Defined in: [packages/core/src/shared/utils/stream-parser.ts:40](https://github.com/YesWeAreBot/YesImBot/blob/8c6be70681e68749107dde97ee37faccaf078b77/packages/core/src/shared/utils/stream-parser.ts#L40)

为指定的顶层键创建一个可读流

#### Type Parameters

##### T

`T` = `any`

#### Parameters

##### key

`string`

必须是 schema 中定义的顶层键之一

#### Returns

`ReadableStream`\<`T`\>
