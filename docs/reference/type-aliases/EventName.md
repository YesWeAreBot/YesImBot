[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / EventName

# Type Alias: EventName

> **EventName** = `string` \| `` `${Genres}-${Actions}` `` \| `"message"` \| `"message-deleted"` \| `"message-updated"` \| `"message-pinned"` \| `"message-unpinned"` \| `"interaction/command"` \| `"reaction-added"` \| `"reaction-deleted"` \| `"reaction-deleted/one"` \| `"reaction-deleted/all"` \| `"reaction-deleted/emoji"` \| `"send"` \| `"friend-request"` \| `"guild-request"` \| `"guild-member-request"`

Defined in: [packages/core/src/services/worldstate/types.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/worldstate/types.ts#L21)

定义了所有可能被捕获的 Koishi 事件名称的联合类型，提供类型安全
