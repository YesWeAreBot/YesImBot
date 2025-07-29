[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / containsFilter

# Function: containsFilter()

> **containsFilter**(`content`, `filterList`): `boolean`

Defined in: [packages/core/src/shared/utils/toolkit.ts:23](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/shared/utils/toolkit.ts#L23)

检查消息内容是否包含过滤词列表中的任意一个词（不区分大小写）。

## Parameters

### content

`string`

要检查的内容。

### filterList

`string`[]

过滤词字符串数组。

## Returns

`boolean`

如果包含任意一个过滤词，则返回 true，否则返回 false。
