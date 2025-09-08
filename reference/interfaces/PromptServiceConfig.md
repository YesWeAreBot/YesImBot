[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / PromptServiceConfig

# Interface: PromptServiceConfig

Defined in: [packages/core/src/services/prompt/config.ts:6](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/config.ts#L6)

PromptService 配置接口

## Properties

### injectionPlaceholder?

> `optional` **injectionPlaceholder**: `string`

Defined in: [packages/core/src/services/prompt/config.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/config.ts#L11)

在模板中用于注入所有扩展片段的占位符名称。

#### Default

```ts
'extensions'
```

***

### maxRenderDepth?

> `optional` **maxRenderDepth**: `number`

Defined in: [packages/core/src/services/prompt/config.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/prompt/config.ts#L16)

模板渲染的最大深度，用于支持片段的二次渲染，同时防止无限循环。

#### Default

```ts
3
```
