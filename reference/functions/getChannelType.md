[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / getChannelType

# Function: getChannelType()

> **getChannelType**(`channelId`): `"private"` \| `"guild"` \| `"sandbox"`

Defined in: [packages/core/src/shared/utils/toolkit.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/91c73ac8adc99fd9fe5ac1678a22415c1645dc09/packages/core/src/shared/utils/toolkit.ts#L75)

根据频道 ID 的格式判断其类型。

## Parameters

### channelId

`string`

频道 ID。

## Returns

`"private"` \| `"guild"` \| `"sandbox"`

频道类型: "private", "guild", 或 "sandbox"。
