[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IRenderer

# Interface: IRenderer

Defined in: [packages/core/src/services/prompt/renderer.ts:7](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/prompt/renderer.ts#L7)

渲染器接口
定义了将模板和作用域结合生成最终字符串的标准方法

## Methods

### render()

> **render**(`templateContent`, `scope`, `partials?`): `string`

Defined in: [packages/core/src/services/prompt/renderer.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/prompt/renderer.ts#L15)

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
