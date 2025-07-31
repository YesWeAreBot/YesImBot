[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / toBoolean

# Function: toBoolean()

> **toBoolean**(`value`): `boolean`

Defined in: [packages/core/src/shared/utils/toolkit.ts:133](https://github.com/YesWeAreBot/YesImBot/blob/d2253e77ca577ebc8cece14ecd60820dcfb9833e/packages/core/src/shared/utils/toolkit.ts#L133)

将各种类型的值转换为布尔值。
规则：
- 布尔值: 直接返回
- 字符串: 'true', '1' -> true; 'false', '0' -> false (不区分大小写，忽略空格)
- 数字: 1 -> true; 0 -> false
- 其他: 使用 JavaScript 的隐式转换规则 (!!value)

## Parameters

### value

`any`

任意类型的值。

## Returns

`boolean`

转换后的布尔值。
