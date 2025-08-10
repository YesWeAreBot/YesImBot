[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Injection

# Interface: Injection

Defined in: [packages/core/src/services/prompt/service.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/prompt/service.ts#L21)

描述一个注入到提示词中的片段。

## Properties

### name

> **name**: `string`

Defined in: [packages/core/src/services/prompt/service.ts:23](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/prompt/service.ts#L23)

注入片段的唯一名称，用于调试和覆盖 (e.g., "my-plugin.tools")

***

### priority

> **priority**: `number`

Defined in: [packages/core/src/services/prompt/service.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/prompt/service.ts#L25)

渲染优先级，数字越小，越先被渲染和展示

***

### renderFn

> **renderFn**: [`Snippet`](../type-aliases/Snippet.md)

Defined in: [packages/core/src/services/prompt/service.ts:27](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/prompt/service.ts#L27)

渲染函数，返回一个字符串或可以被渲染为字符串的内容
