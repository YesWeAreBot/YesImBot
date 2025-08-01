[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / debounce

# Function: debounce()

> **debounce**\<`T`\>(`func`, `wait`): (...`args`) => `void`

Defined in: [packages/core/src/shared/utils/toolkit.ts:203](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/shared/utils/toolkit.ts#L203)

创建一个防抖函数，该函数会从上一次被调用后，延迟 `wait` 毫秒后调用 `func` 方法。

## Type Parameters

### T

`T` *extends* (...`args`) => `any`

## Parameters

### func

`T`

要防抖的函数。

### wait

`number`

需要延迟的毫秒数。

## Returns

返回新的防抖函数。

> (...`args`): `void`

### Parameters

#### args

...`Parameters`\<`T`\>

### Returns

`void`
