[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / GuildMember

# Interface: GuildMember

Defined in: [packages/core/src/services/worldstate/types.ts:90](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L90)

代表一个群组或服务器中的成员，是用户在特定群组上下文中的表现

## Properties

### isSelf?

> `optional` **isSelf**: `boolean`

Defined in: [packages/core/src/services/worldstate/types.ts:102](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L102)

[NEW] 一个布尔值，用于明确标记此成员是否为机器人自身

***

### joinedAt?

> `optional` **joinedAt**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:100](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L100)

加入群组的时间戳

***

### name?

> `optional` **name**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:96](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L96)

成员的全局用户名

***

### nick?

> `optional` **nick**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:94](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L94)

成员在群内的显示名称 (通常是昵称)

***

### pid

> **pid**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:92](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L92)

关联的用户平台 ID (pid)

***

### roles?

> `optional` **roles**: `string`[]

Defined in: [packages/core/src/services/worldstate/types.ts:98](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/worldstate/types.ts#L98)

成员拥有的角色列表
