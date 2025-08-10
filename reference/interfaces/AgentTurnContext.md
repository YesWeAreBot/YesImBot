[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AgentTurnContext

# Interface: AgentTurnContext

Defined in: [packages/core/src/services/worldstate/types.ts:126](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L126)

Agent 响应回合在上下文中的表现形式（支持优雅降级）

## Properties

### actions?

> `optional` **actions**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:132](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L132)

行动 (Action): Agent 决定执行的具体动作。

#### function

> **function**: `string`

#### params

> **params**: `Record`\<`string`, `unknown`\>

***

### is\_new?

> `optional` **is\_new**: `boolean`

Defined in: [packages/core/src/services/worldstate/types.ts:128](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L128)

***

### observations?

> `optional` **observations**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:134](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L134)

观察 (Observation): 执行动作后获得的结果。这是最先被移除的部分。

#### function

> **function**: `string`

#### result?

> `optional` **result**: `any`

#### status

> **status**: `string`

***

### thoughts?

> `optional` **thoughts**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:130](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L130)

思考过程 (Thought): Agent 的内心独白。这是最有价值、保留最久的部分。

#### analyze\_infer

> **analyze\_infer**: `string`

#### observe

> **observe**: `string`

#### plan

> **plan**: `string`

***

### timestamp

> **timestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:127](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/worldstate/types.ts#L127)
