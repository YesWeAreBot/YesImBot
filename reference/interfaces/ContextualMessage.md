[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ContextualMessage

# Interface: ContextualMessage

Defined in: [packages/core/src/services/worldstate/types.ts:173](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L173)

代表在特定上下文中（如一个DialogueSegment里）的一条消息

## Properties

### content

> **content**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:176](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L176)

消息内容

***

### elements?

> `optional` **elements**: `Element`[]

Defined in: [packages/core/src/services/worldstate/types.ts:177](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L177)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:174](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L174)

***

### quoteId?

> `optional` **quoteId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:181](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L181)

引用另一条消息的ID

***

### sender

> **sender**: [`Sender`](Sender.md)

Defined in: [packages/core/src/services/worldstate/types.ts:182](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L182)

***

### timestamp

> **timestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:179](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L179)

消息发送的时间戳
