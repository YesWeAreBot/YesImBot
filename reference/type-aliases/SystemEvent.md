[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / SystemEvent

# Type Alias: SystemEvent

> **SystemEvent** = [`GenericSystemEvent`](GenericSystemEvent.md) \| [`MemberJoinEvent`](MemberJoinEvent.md) \| [`CommandInvocationEvent`](CommandInvocationEvent.md)

Defined in: [packages/core/src/services/worldstate/types.ts:83](https://github.com/YesWeAreBot/YesImBot/blob/106be9775095e46067c209d9f2c1e741908ba4b8/packages/core/src/services/worldstate/types.ts#L83)

`SystemEvent` 是所有非消息事件的联合类型
未来可以通过向此联合类型添加更多具体的事件类型来扩展事件系统
