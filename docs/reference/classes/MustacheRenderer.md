[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MustacheRenderer

# Class: MustacheRenderer

Defined in: [packages/core/src/services/prompt/renderer.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/prompt/renderer.ts#L21)

基于 Mustache.js 的默认渲染器实现

## Implements

- [`IRenderer`](../interfaces/IRenderer.md)

## Constructors

### Constructor

> **new MustacheRenderer**(): `MustacheRenderer`

#### Returns

`MustacheRenderer`

## Methods

### render()

> **render**(`templateContent`, `scope`, `partials?`): `string`

Defined in: [packages/core/src/services/prompt/renderer.ts:22](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/prompt/renderer.ts#L22)

渲染模板

#### Parameters

##### templateContent

`string`

模板字符串

##### scope

`Record`\<`string`, `any`\>

包含所有动态数据的上下文对象

##### partials?

`Record`\<`string`, `string`\>

用于模板引用的可重用模板片段 (例如 {{> myPartial}})

#### Returns

`string`

渲染后的字符串

#### Implementation of

[`IRenderer`](../interfaces/IRenderer.md).[`render`](../interfaces/IRenderer.md#render)
