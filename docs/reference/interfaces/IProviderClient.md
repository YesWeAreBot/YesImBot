[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IProviderClient

# Interface: IProviderClient

Defined in: [packages/core/src/services/model/factories.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L25)

## Properties

### chat()?

> `optional` **chat**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L26)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### embed()?

> `optional` **embed**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:27](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L27)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### image()?

> `optional` **image**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:28](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L28)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### model()?

> `optional` **model**: () => `Omit`\<`CommonRequestOptions`, `"model"`\>

Defined in: [packages/core/src/services/model/factories.ts:31](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L31)

#### Returns

`Omit`\<`CommonRequestOptions`, `"model"`\>

***

### speech()?

> `optional` **speech**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:29](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L29)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`

***

### transcript()?

> `optional` **transcript**: (`model`) => `CommonRequestOptions`

Defined in: [packages/core/src/services/model/factories.ts:30](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/factories.ts#L30)

#### Parameters

##### model

`string` | `string` & `object`

#### Returns

`CommonRequestOptions`
