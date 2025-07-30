[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / UserProfile

# Interface: UserProfile

Defined in: [packages/core/src/services/memory/types.ts:133](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L133)

用户画像 (UserProfile)
对特定用户在特定上下文中的深度、动态总结
每个UserProfile都与一个用户和一个上下文绑定

## Extends

- [`Searchable`](Searchable.md)

## Properties

### confidence?

> `optional` **confidence**: `number`

Defined in: [packages/core/src/services/memory/types.ts:163](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L163)

画像置信度评分，用于判断画像的准确性和完整性

***

### content

> **content**: `string`

Defined in: [packages/core/src/services/memory/types.ts:145](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L145)

***

### contextId

> **contextId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:143](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L143)

画像的上下文ID
'global' 代表这是一个全局画像
其他字符串代表特定的群聊或私聊ID

***

### createdAt?

> `optional` **createdAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:151](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L151)

创建时间

***

### embedding

> **embedding**: `number`[]

Defined in: [packages/core/src/services/memory/types.ts:146](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L146)

#### Overrides

[`Searchable`](Searchable.md).[`embedding`](Searchable.md#embedding)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/memory/types.ts:134](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L134)

***

### isDeleted?

> `optional` **isDeleted**: `boolean`

Defined in: [packages/core/src/services/memory/types.ts:155](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L155)

是否已删除（软删除）

#### Overrides

[`Searchable`](Searchable.md).[`isDeleted`](Searchable.md#isdeleted)

***

### keyFactsForUpdate?

> `optional` **keyFactsForUpdate**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:159](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L159)

关键事实用于下次增量更新

***

### salience

> **salience**: `number`

Defined in: [packages/core/src/services/memory/types.ts:161](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L161)

显著性评分，用于搜索排序

#### Overrides

[`Searchable`](Searchable.md).[`salience`](Searchable.md#salience)

***

### supportingFactIds

> **supportingFactIds**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:147](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L147)

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:157](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L157)

画像标签，用于分类

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:149](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L149)

***

### userId

> **userId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:135](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L135)

***

### userName

> **userName**: `string`

Defined in: [packages/core/src/services/memory/types.ts:136](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L136)

***

### version?

> `optional` **version**: `number`

Defined in: [packages/core/src/services/memory/types.ts:153](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/memory/types.ts#L153)

画像版本号，用于跟踪更新
