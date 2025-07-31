[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:250](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L250)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:282](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L282)

#### Parameters

##### ctx

`Context`

##### groupConfig

###### models

[`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

###### name

`string`

###### strategy

[`ModelSwitchingStrategy`](../enumerations/ModelSwitchingStrategy.md)

##### modelGetter

(`providerName`, `modelId`) => `T`

#### Returns

`ModelSwitcher`\<`T`\>

## Accessors

### current

#### Get Signature

> **get** **current**(): `T`

Defined in: [packages/core/src/services/model/model-service.ts:264](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L264)

##### Returns

`T`

***

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [packages/core/src/services/model/model-service.ts:278](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L278)

##### Returns

`number`

***

### models

#### Get Signature

> **get** **models**(): `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:260](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L260)

##### Returns

`T`[]

## Methods

### executeChat()

> **executeChat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:361](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L361)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:346](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L346)

获取此模型组中所有模型的列表（只读）。

#### Returns

readonly `T`[]

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:339](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L339)

检查此模型组是否包含任何支持视觉（图片识别）的模型。

#### Returns

`boolean`

***

### next()

> **next**(): `T`

Defined in: [packages/core/src/services/model/model-service.ts:268](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/model-service.ts#L268)

#### Returns

`T`
