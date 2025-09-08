[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / HistoryConfig

# Interface: HistoryConfig

Defined in: [packages/core/src/services/worldstate/config.ts:6](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L6)

多级缓存记忆模型管理配置

## Properties

### cleanupIntervalSec

> **cleanupIntervalSec**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L42)

***

### dataRetentionDays

> **dataRetentionDays**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L41)

***

### ignoreSelfMessage

> **ignoreSelfMessage**: `boolean`

Defined in: [packages/core/src/services/worldstate/config.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L38)

***

### l1\_memory

> **l1\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:8](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L8)

#### keepFullTurnCount

> **keepFullTurnCount**: `number`

保留完整 Agent 响应（思考、行动、观察）的最新轮次数

#### maxMessages

> **maxMessages**: `number`

工作记忆中最多包含的消息数量，超出部分将被平滑裁剪

#### pendingTurnTimeoutSec

> **pendingTurnTimeoutSec**: `number`

pending 状态的轮次在多长时间内没有新消息后被强制关闭（秒）

***

### l2\_memory

> **l2\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:18](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L18)

#### enabled

> **enabled**: `boolean`

启用 L2 记忆检索

#### includeNeighborChunks

> **includeNeighborChunks**: `boolean`

是否扩展相邻chunk

#### messagesPerChunk

> **messagesPerChunk**: `number`

每个语义记忆片段包含的消息数量

#### retrievalK

> **retrievalK**: `number`

检索时返回的最大记忆片段数量

#### retrievalMinSimilarity

> **retrievalMinSimilarity**: `number`

向量相似度搜索的最低置信度阈值，低于此值的结果将被过滤

***

### l3\_memory

> **l3\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:32](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/worldstate/config.ts#L32)

#### diaryGenerationTime

> **diaryGenerationTime**: `string`

每日生成日记的时间 (HH:mm)

#### enabled

> **enabled**: `boolean`

启用 L3 日记功能
