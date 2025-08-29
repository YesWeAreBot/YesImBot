[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / StreamParser

# Class: StreamParser

Defined in: [packages/core/src/shared/utils/stream-parser.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/shared/utils/stream-parser.ts#L15)

通用流式解析器

## Constructors

### Constructor

> **new StreamParser**(`schema`): `StreamParser`

Defined in: [packages/core/src/shared/utils/stream-parser.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/shared/utils/stream-parser.ts#L25)

#### Parameters

##### schema

`Schema`

#### Returns

`StreamParser`

## Methods

### process()

> **process**(`stream`): `Promise`\<`void`\>

Defined in: [packages/core/src/shared/utils/stream-parser.ts:72](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/shared/utils/stream-parser.ts#L72)

处理输入的字符串流，并根据 schema 将数据推送到对应的子流中

#### Parameters

##### stream

`AsyncGenerator`\<`string`\>

#### Returns

`Promise`\<`void`\>

***

### processText()

> **processText**(`text`, `final`): `void`

Defined in: [packages/core/src/shared/utils/stream-parser.ts:56](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/shared/utils/stream-parser.ts#L56)

#### Parameters

##### text

`string`

##### final

`boolean`

#### Returns

`void`

***

### stream()

> **stream**\<`T`\>(`key`): `ReadableStream`\<`T`\>

Defined in: [packages/core/src/shared/utils/stream-parser.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/shared/utils/stream-parser.ts#L34)

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
