[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentResponseData

# Interface: AgentResponseData

Defined in: [packages/core/src/services/worldstate/database-models.ts:73](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L73)

`worldstate.agent_responses` 表的数据结构

## Properties

### actions

> **actions**: [`Action`](Action.md)[]

Defined in: [packages/core/src/services/worldstate/database-models.ts:77](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L77)

***

### id

> **id**: `number`

Defined in: [packages/core/src/services/worldstate/database-models.ts:74](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L74)

***

### observations

> **observations**: [`ActionResult`](ActionResult.md)[]

Defined in: [packages/core/src/services/worldstate/database-models.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L78)

***

### request\_heartbeat

> **request\_heartbeat**: `boolean`

Defined in: [packages/core/src/services/worldstate/database-models.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L79)

***

### thoughts

> **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/database-models.ts:76](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L76)

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`

***

### turnId

> **turnId**: `string`

Defined in: [packages/core/src/services/worldstate/database-models.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/database-models.ts#L75)
