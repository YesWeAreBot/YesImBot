[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / isEmpty

# Function: isEmpty()

> **isEmpty**(`str`): `boolean`

Defined in: [packages/core/src/shared/utils/string.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/shared/utils/string.ts#L15)

检查字符串是否为 null、undefined、空字符串或仅包含空白字符。

## Parameters

### str

`string`

要检查的字符串。

## Returns

`boolean`

如果字符串为空或仅包含空白，则返回 true，否则返回 false。

## Example

```ts
isEmpty(null); // true
isEmpty(''); // true
isEmpty('  '); // true
isEmpty('hello'); // false
```
