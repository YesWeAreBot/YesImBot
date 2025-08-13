[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IProviderClient

# Interface: IProviderClient

Defined in: [packages/core/src/services/model/factories.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L42)

## Properties

### chat()?

> `optional` **chat**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L43)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### embed()?

> `optional` **embed**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L44)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### image()?

> `optional` **image**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L45)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### model()?

> `optional` **model**: () => `Omit`\<`CommonRequestOptions`, `"model"`\>

Defined in: [packages/core/src/services/model/factories.ts:48](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L48)

#### Returns

`Omit`\<`CommonRequestOptions`, `"model"`\>

***

### speech()?

> `optional` **speech**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:46](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L46)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### transcript()?

> `optional` **transcript**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/factories.ts#L47)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`
