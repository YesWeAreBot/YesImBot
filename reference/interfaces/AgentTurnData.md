[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentTurnData

# Interface: AgentTurnData

Defined in: [packages/core/src/services/worldstate/types.ts:61](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L61)

Agent 响应回合的数据模型，包含完整的思考链。

## Properties

### actions

> **actions**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L69)

#### function

> **function**: `string`

#### params

> **params**: `Record`\<`string`, `unknown`\>

***

### channelId

> **channelId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:64](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L64)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:62](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L62)

***

### observations

> **observations**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:71](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L71)

#### error?

> `optional` **error**: `any`

#### function

> **function**: `string`

#### result?

> `optional` **result**: `any`

#### status

> **status**: `string`

***

### platform

> **platform**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:63](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L63)

***

### request\_heartbeat

> **request\_heartbeat**: `boolean`

Defined in: [packages/core/src/services/worldstate/types.ts:72](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L72)

***

### thoughts

> **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:67](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L67)

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`

***

### timestamp

> **timestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:65](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L65)
