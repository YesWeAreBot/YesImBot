[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ValidationOptions

# Interface: ValidationOptions

Defined in: [packages/core/src/services/model/chat-model.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/chat-model.ts#L36)

传递给 chat 方法的验证选项

## Properties

### format?

> `optional` **format**: `"json"`

Defined in: [packages/core/src/services/model/chat-model.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/chat-model.ts#L38)

预期的响应格式，用于选择内置验证器

***

### validator?

> `optional` **validator**: [`ContentValidator`](../type-aliases/ContentValidator.md)

Defined in: [packages/core/src/services/model/chat-model.ts:40](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/chat-model.ts#L40)

自定义验证函数，优先级高于 format
