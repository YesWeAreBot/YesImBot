[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentStimulus

# Interface: AgentStimulus\<T\>

Defined in: [packages/core/src/services/worldstate/types.ts:376](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L376)

统一的智能体刺激接口。
所有外部或内部事件都应被转换为此标准格式，再由 AgentCore 处理。

## Type Parameters

### T

`T`

载荷的具体类型。

## Properties

### channelCid

> **channelCid**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:380](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L380)

刺激发生的目标频道 CID ('platform:channelId')

***

### payload

> **payload**: `T`

Defined in: [packages/core/src/services/worldstate/types.ts:386](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L386)

与刺激类型相关的具体数据

***

### priority

> **priority**: `number`

Defined in: [packages/core/src/services/worldstate/types.ts:384](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L384)

刺激的优先级 (e.g., 1-10)，用于未来处理冲突或进行决策

***

### session

> **session**: `Session`

Defined in: [packages/core/src/services/worldstate/types.ts:382](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L382)

触发刺激的原始 Session 对象，用于获取 Bot 实例等上下文信息

***

### type

> **type**: [`StimulusType`](../type-aliases/StimulusType.md)

Defined in: [packages/core/src/services/worldstate/types.ts:378](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L378)

刺激的类型
