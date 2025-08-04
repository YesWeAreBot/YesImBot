[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentResponseData

# Interface: AgentResponseData

Defined in: [packages/core/src/services/worldstate/database-models.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L75)

`worldstate.agent_responses` 表的数据结构

## Properties

### actions

> **actions**: [`Action`](Action.md)[]

Defined in: [packages/core/src/services/worldstate/database-models.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L79)

***

### id

> **id**: `number`

Defined in: [packages/core/src/services/worldstate/database-models.ts:76](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L76)

***

### observations

> **observations**: [`ActionResult`](ActionResult.md)[]

Defined in: [packages/core/src/services/worldstate/database-models.ts:80](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L80)

***

### request\_heartbeat

> **request\_heartbeat**: `boolean`

Defined in: [packages/core/src/services/worldstate/database-models.ts:81](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L81)

***

### thoughts

> **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/database-models.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L78)

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`

***

### turnId

> **turnId**: `string`

Defined in: [packages/core/src/services/worldstate/database-models.ts:77](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/worldstate/database-models.ts#L77)
