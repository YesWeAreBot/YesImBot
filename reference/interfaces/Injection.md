[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Injection

# Interface: Injection

Defined in: [packages/core/src/services/prompt/service.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/service.ts#L10)

## Properties

### name

> **name**: `string`

Defined in: [packages/core/src/services/prompt/service.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/service.ts#L12)

注入片段的唯一名称，用于调试和覆盖 (e.g., "my-plugin.tools")

***

### priority

> **priority**: `number`

Defined in: [packages/core/src/services/prompt/service.ts:14](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/service.ts#L14)

渲染优先级，数字越小，越先被渲染和展示

***

### renderFn

> **renderFn**: [`Snippet`](../type-aliases/Snippet.md)

Defined in: [packages/core/src/services/prompt/service.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/service.ts#L16)

渲染函数，返回一个字符串或可以被渲染为字符串的内容
