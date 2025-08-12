[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IRenderer

# Interface: IRenderer

Defined in: [packages/core/src/services/prompt/renderer.ts:17](https://github.com/YesWeAreBot/YesImBot/blob/adb35f67476926d999e6b7708fa073b812c7537a/packages/core/src/services/prompt/renderer.ts#L17)

渲染器接口
定义了将模板和作用域结合生成最终字符串的标准方法

## Methods

### render()

> **render**(`templateContent`, `scope`, `partials?`, `options?`): `string`

Defined in: [packages/core/src/services/prompt/renderer.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/adb35f67476926d999e6b7708fa073b812c7537a/packages/core/src/services/prompt/renderer.ts#L26)

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

[`RenderOptions`](RenderOptions.md)

渲染选项，如最大深度

#### Returns

`string`

渲染后的字符串
