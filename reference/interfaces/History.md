[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / History

# Interface: History

Defined in: [packages/core/src/services/worldstate/types.ts:150](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/types.ts#L150)

频道的历史记录流
pending: 包含新的、未处理的消息
closed: 包含已处理的消息，但未被折叠
folded: 包含已折叠的消息
summarized: 包含已总结的消息

## Properties

### closed?

> `optional` **closed**: [`ClosedDialogueSegment`](ClosedDialogueSegment.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:152](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/types.ts#L152)

***

### folded?

> `optional` **folded**: [`FoldedDialogueSegment`](FoldedDialogueSegment.md)

Defined in: [packages/core/src/services/worldstate/types.ts:153](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/types.ts#L153)

***

### pending

> **pending**: [`PendingDialogueSegment`](PendingDialogueSegment.md)

Defined in: [packages/core/src/services/worldstate/types.ts:151](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/types.ts#L151)

***

### summarized?

> `optional` **summarized**: [`SummarizedDialogueSegment`](SummarizedDialogueSegment.md)

Defined in: [packages/core/src/services/worldstate/types.ts:154](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/types.ts#L154)
