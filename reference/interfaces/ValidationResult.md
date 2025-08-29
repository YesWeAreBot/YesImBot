[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ValidationResult

# Interface: ValidationResult

Defined in: [packages/core/src/services/model/chat-model.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/chat-model.ts#L15)

验证器函数的返回值

## Properties

### earlyExit

> **earlyExit**: `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:19](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/chat-model.ts#L19)

是否可以提前结束流并返回

***

### error?

> `optional` **error**: `string`

Defined in: [packages/core/src/services/model/chat-model.ts:23](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/chat-model.ts#L23)

错误信息 (可选)

***

### parsedData?

> `optional` **parsedData**: `any`

Defined in: [packages/core/src/services/model/chat-model.ts:21](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/chat-model.ts#L21)

解析后的数据 (可选)

***

### valid

> **valid**: `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:17](https://github.com/YesWeAreBot/YesImBot/blob/16ac3f6266cfeb3e99fd673931aa5eb481c6c199/packages/core/src/services/model/chat-model.ts#L17)

内容是否有效
