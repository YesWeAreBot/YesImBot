[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / HistoryConfig

# Interface: HistoryConfig

Defined in: [packages/core/src/services/worldstate/config.ts:13](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L13)

对话历史管理配置

## Properties

### allowedChannels?

> `readonly` `optional` **allowedChannels**: `Set`\<`string`\>

Defined in: [packages/core/src/services/worldstate/config.ts:49](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L49)

***

### cleanupIntervalSec

> **cleanupIntervalSec**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L47)

后台清理任务的执行频率（秒）

***

### dataRetentionDays

> **dataRetentionDays**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L45)

历史数据在被永久删除前的最大保留天数

***

### fullContextSegmentCount

> **fullContextSegmentCount**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:28](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L28)

在上下文中保留的最新"完整"对话片段数量

***

### inactivityTimeoutSec

> **inactivityTimeoutSec**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:31](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L31)

***

### maxMessages

> **maxMessages**: `number`

Defined in: [packages/core/src/services/worldstate/config.ts:30](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L30)

上下文中最多包含的用户消息数

***

### recall

> **recall**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L34)

#### guild

> **guild**: `number`

群组场景下召回用户画像的数量

#### minConfidence

> **minConfidence**: `number`

最低置信度

#### private

> **private**: `number`

私聊场景下召回用户画像的数量

***

### summarization

> **summarization**: `object`

Defined in: [packages/core/src/services/worldstate/config.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L15)

#### enabled

> **enabled**: `boolean`

启用对话历史总结功能

#### minTriggerMessages

> **minTriggerMessages**: `number`

单次最少压缩的消息数量

#### prompt

> **prompt**: `string`

用于生成对话摘要的提示词模板

#### triggerCount

> **triggerCount**: `number`

当待总结的片段达到此数量时，触发总结任务

***

### system?

> `readonly` `optional` **system**: `SystemConfig`

Defined in: [packages/core/src/services/worldstate/config.ts:50](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/config.ts#L50)
