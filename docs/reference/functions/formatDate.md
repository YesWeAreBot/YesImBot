[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / formatDate

# Function: formatDate()

> **formatDate**(`date`, `format`): `string`

Defined in: [packages/core/src/shared/utils/toolkit.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/shared/utils/toolkit.ts#L45)

格式化日期对象或时间戳为指定格式的字符串。

## Parameters

### date

Date 对象或毫秒级时间戳。

`number` | `Date`

### format

`string` = `"YYYY-MM-DD HH:mm:ss"`

格式化模板，默认为 "YYYY-MM-DD HH:mm:ss"。
  支持的标记：YYYY, YY, MM, M, DD, D, HH, H, mm, m, ss, s

## Returns

`string`

格式化后的日期字符串。
