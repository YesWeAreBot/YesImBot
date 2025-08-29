[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentResponse

# Interface: AgentResponse

Defined in: [packages/core/src/services/worldstate/types.ts:64](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/worldstate/types.ts#L64)

## Description

从LLM响应中解析出的、尚未持久化的数据结构。
这是 `HeartbeatProcessor` 内部流转的核心对象。

## Properties

### actions

> **actions**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:66](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/worldstate/types.ts#L66)

#### function

> **function**: `string`

#### params

> **params**: `Record`\<`string`, `unknown`\>

***

### observations?

> `optional` **observations**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:67](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/worldstate/types.ts#L67)

#### error?

> `optional` **error**: `any`

#### function

> **function**: `string`

#### result?

> `optional` **result**: `any`

#### status

> **status**: `string`

***

### request\_heartbeat

> **request\_heartbeat**: `boolean`

Defined in: [packages/core/src/services/worldstate/types.ts:68](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/worldstate/types.ts#L68)

***

### thoughts

> **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:65](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/worldstate/types.ts#L65)

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`
