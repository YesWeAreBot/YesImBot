[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentTurn

# Interface: AgentTurn

Defined in: [packages/core/src/services/worldstate/types.ts:192](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/worldstate/types.ts#L192)

Agent 的一个完整处理回合，通常对应一次或多次 ReAct 循环

## Properties

### responses

> **responses**: [`AgentResponse`](AgentResponse.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:194](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/worldstate/types.ts#L194)

此回合中发生的所有响应步骤（思考->行动->观察）

***

### timestamp

> **timestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:196](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/worldstate/types.ts#L196)

Agent 回合完成的时间戳
