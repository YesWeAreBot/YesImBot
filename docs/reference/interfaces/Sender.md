[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Sender

# Interface: Sender

Defined in: [packages/core/src/services/worldstate/types.ts:161](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/worldstate/types.ts#L161)

发送者信息快照
记录了消息发送时刻用户的关键信息

## Properties

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:163](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/worldstate/types.ts#L163)

用户的平台唯一ID (pid)

***

### name?

> `optional` **name**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:165](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/worldstate/types.ts#L165)

发送消息时用户的显示名称 (昵称)

***

### roles?

> `optional` **roles**: `string`[]

Defined in: [packages/core/src/services/worldstate/types.ts:167](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/worldstate/types.ts#L167)

发送消息时用户的角色
