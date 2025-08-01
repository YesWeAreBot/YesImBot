[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolCallResult

# Interface: ToolCallResult\<TResult, TError\>

Defined in: [packages/core/src/services/extension/types.ts:74](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/extension/types.ts#L74)

标准化的工具调用结果

## Type Parameters

### TResult

`TResult` = `any`

### TError

`TError` *extends* [`ToolError`](ToolError.md) = [`ToolError`](ToolError.md)

## Properties

### error?

> `optional` **error**: `TError`

Defined in: [packages/core/src/services/extension/types.ts:84](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/extension/types.ts#L84)

失败时的结构化错误信息

***

### metadata?

> `optional` **metadata**: `object`

Defined in: [packages/core/src/services/extension/types.ts:86](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/extension/types.ts#L86)

附加元数据，如执行时间(ms)、Token消耗等

#### Index Signature

\[`key`: `string`\]: `any`

#### execution\_duration\_ms?

> `optional` **execution\_duration\_ms**: `number`

***

### result?

> `optional` **result**: `TResult`

Defined in: [packages/core/src/services/extension/types.ts:82](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/extension/types.ts#L82)

成功时的返回结果

***

### status

> **status**: `"success"` \| `"error"`

Defined in: [packages/core/src/services/extension/types.ts:80](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/extension/types.ts#L80)

调用状态:
- 'success': 成功
- 'error': 失败
