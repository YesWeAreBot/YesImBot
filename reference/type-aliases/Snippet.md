[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Snippet

# Type Alias: Snippet()

> **Snippet** = (`currentScope`) => `any` \| `Promise`\<`any`\>

Defined in: [packages/core/src/services/prompt/service.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/prompt/service.ts#L12)

片段 (Snippet) 是一个函数，用于在运行时动态生成内容。

## Parameters

### currentScope

`Record`\<`string`, `any`\>

当前正在构建的作用域对象，允许片段之间存在依赖关系。

## Returns

`any` \| `Promise`\<`any`\>

返回将要注入到作用域中的数据，可以是任何类型。
