[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / HistoryConfig

# Interface: HistoryConfig

Defined in: [packages/core/src/services/worldstate/config.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L9)

多级缓存记忆模型管理配置

## Properties

### allowedChannels?

> `readonly` `optional` **allowedChannels**: `ChannelDescriptor`[]

Defined in: [packages/core/src/services/worldstate/config.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L44)

***

### cleanupIntervalSec

> **cleanupIntervalSec**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:42](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L42)

***

### dataRetentionDays

> **dataRetentionDays**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L41)

***

### l1\_memory

> **l1\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L11)

#### keepFullTurnCount

> **keepFullTurnCount**: `number`

#### maxMessages

> **maxMessages**: `number`

工作记忆中最多包含的消息数量，超出部分将被平滑裁剪

#### pendingTurnTimeoutSec

> **pendingTurnTimeoutSec**: `number`

pending 状态的轮次在多长时间内没有新消息后被强制关闭（秒）

***

### l2\_memory

> **l2\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L21)

#### enabled

> **enabled**: `boolean`

启用 L2 记忆检索

#### messageOverlap

> **messageOverlap**: `number`

记忆片段之间重叠的消息数量，以保持上下文连续性

#### messagesPerChunk

> **messagesPerChunk**: `number`

每个语义记忆片段包含的消息数量

#### retrievalK

> **retrievalK**: `number`

检索时返回的最大记忆片段数量

***

### l3\_memory

> **l3\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L33)

#### diaryGenerationTime

> **diaryGenerationTime**: `string`

每日生成日记的时间 (HH:mm)

#### enabled

> **enabled**: `boolean`

启用 L3 日记功能

***

### system?

> `readonly` `optional` **system**: `SystemConfig`

Defined in: [packages/core/src/services/worldstate/config.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/config.ts#L45)
