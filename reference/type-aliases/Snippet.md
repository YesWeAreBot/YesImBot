[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Snippet

# Type Alias: Snippet()

> **Snippet** = (`currentScope`) => `any` \| `Promise`\<`any`\>

Defined in: [packages/core/src/services/prompt/service.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/prompt/service.ts#L15)

片段 (Snippet) 是一个函数，用于在运行时动态生成内容。

## Parameters

### currentScope

`Record`\<`string`, `any`\>

当前正在构建的作用域对象，允许片段之间存在依赖关系。

## Returns

`any` \| `Promise`\<`any`\>

返回将要注入到作用域中的数据，可以是任何类型。
