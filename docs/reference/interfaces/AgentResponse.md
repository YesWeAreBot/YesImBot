[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentResponse

# Interface: AgentResponse

Defined in: [packages/core/src/services/worldstate/types.ts:272](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L272)

代表 Agent 在 ReAct 循环中的一个完整步骤 (Thought -> Action -> Observation)

## Properties

### actions

> **actions**: [`Action`](Action.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:283](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L283)

行动 (Action): Agent 决定执行的一个或多个具体动作

***

### observations

> **observations**: [`ActionResult`](ActionResult.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:288](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L288)

观察 (Observation): 执行动作后从环境中获得的结果
这个结果将成为下一个 `AgentResponse` 中 `thoughts.observe` 的输入

***

### request\_heartbeat

> **request\_heartbeat**: `boolean`

Defined in: [packages/core/src/services/worldstate/types.ts:294](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L294)

是否请求心跳
若为 true，表示 Agent 希望立即进入下一个处理循环，即使没有新的外部事件
用于需要连续执行多步操作的场景

***

### thoughts

> **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:279](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L279)

思考过程 (Thought): Agent 的内心独白
- `observe`: 对当前情景的观察和总结
- `analyze_infer`: 分析观察结果，进行推理
- `plan`: 基于分析和推理，制定下一步行动计划

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`
