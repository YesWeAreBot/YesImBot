[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / getChannelType

# Function: getChannelType()

> **getChannelType**(`channelId`): `"private"` \| `"guild"` \| `"sandbox"`

Defined in: [packages/core/src/shared/utils/toolkit.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/shared/utils/toolkit.ts#L75)

根据频道 ID 的格式判断其类型。

## Parameters

### channelId

`string`

频道 ID。

## Returns

`"private"` \| `"guild"` \| `"sandbox"`

频道类型: "private", "guild", 或 "sandbox"。
