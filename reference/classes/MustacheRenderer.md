[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MustacheRenderer

# Class: MustacheRenderer

Defined in: [packages/core/src/services/prompt/renderer.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/prompt/renderer.ts#L33)

基于 Mustache.js 的默认渲染器实现
支持二次渲染和循环保护

## Implements

- [`IRenderer`](../interfaces/IRenderer.md)

## Constructors

### Constructor

> **new MustacheRenderer**(): `MustacheRenderer`

#### Returns

`MustacheRenderer`

## Methods

### render()

> **render**(`templateContent`, `scope`, `partials?`, `options?`): `string`

Defined in: [packages/core/src/services/prompt/renderer.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/prompt/renderer.ts#L34)

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

##### options?

[`RenderOptions`](../interfaces/RenderOptions.md)

渲染选项，如最大深度

#### Returns

`string`

渲染后的字符串

#### Implementation of

[`IRenderer`](../interfaces/IRenderer.md).[`render`](../interfaces/IRenderer.md#render)
