[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / UserDossier

# Interface: UserDossier

Defined in: [packages/core/src/services/memory/types.ts:171](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L171)

用户档案 (User Dossier)
这是一个在代码中动态构建的、用户的完整多面化档案索引
它本身不直接存储在数据库，而是引用存储在数据库中的UserProfile记录

## Properties

### contextualProfileIds

> **contextualProfileIds**: `Map`\<`string`, `string`\>

Defined in: [packages/core/src/services/memory/types.ts:186](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L186)

情境化画像ID的映射
Key是 contextId (如群聊ID), Value是对应的 UserProfile ID

***

### globalProfileId

> **globalProfileId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:180](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L180)

全局画像的ID
引用存储在UserProfile表中的、contextId为'global'的记录

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/memory/types.ts:172](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L172)

***

### userId

> **userId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:173](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L173)

***

### userName

> **userName**: `string`

Defined in: [packages/core/src/services/memory/types.ts:174](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/memory/types.ts#L174)
