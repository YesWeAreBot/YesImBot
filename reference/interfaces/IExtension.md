[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IExtension

# Interface: IExtension\<TConfig\>

Defined in: [packages/core/src/services/extension/types.ts:95](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/extension/types.ts#L95)

扩展包实例需要实现的接口。

## Extends

- `Object`

## Type Parameters

### TConfig

`TConfig` = `any`

## Properties

### config

> **config**: `TConfig`

Defined in: [packages/core/src/services/extension/types.ts:97](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/extension/types.ts#L97)

***

### constructor

> **constructor**: `Function`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:125

The initial value of Object.prototype.constructor is the standard built-in Object constructor.

#### Inherited from

`Object.constructor`

***

### ctx

> **ctx**: `Context`

Defined in: [packages/core/src/services/extension/types.ts:96](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/extension/types.ts#L96)

***

### metadata

> **metadata**: [`ExtensionMetadata`](ExtensionMetadata.md)

Defined in: [packages/core/src/services/extension/types.ts:98](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/extension/types.ts#L98)

***

### tools

> **tools**: `Map`\<`string`, [`ToolDefinition`](ToolDefinition.md)\<`any`\>\>

Defined in: [packages/core/src/services/extension/types.ts:99](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/extension/types.ts#L99)

## Methods

### hasOwnProperty()

> **hasOwnProperty**(`v`): `boolean`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:140

Determines whether an object has a property with the specified name.

#### Parameters

##### v

`PropertyKey`

A property name.

#### Returns

`boolean`

#### Inherited from

`Object.hasOwnProperty`

***

### isPrototypeOf()

> **isPrototypeOf**(`v`): `boolean`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:146

Determines whether an object exists in another object's prototype chain.

#### Parameters

##### v

`Object`

Another object whose prototype chain is to be checked.

#### Returns

`boolean`

#### Inherited from

`Object.isPrototypeOf`

***

### propertyIsEnumerable()

> **propertyIsEnumerable**(`v`): `boolean`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:152

Determines whether a specified property is enumerable.

#### Parameters

##### v

`PropertyKey`

A property name.

#### Returns

`boolean`

#### Inherited from

`Object.propertyIsEnumerable`

***

### toLocaleString()

> **toLocaleString**(): `string`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:131

Returns a date converted to a string using the current locale.

#### Returns

`string`

#### Inherited from

`Object.toLocaleString`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:128

Returns a string representation of an object.

#### Returns

`string`

#### Inherited from

`Object.toString`

***

### valueOf()

> **valueOf**(): `Object`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:134

Returns the primitive value of the specified object.

#### Returns

`Object`

#### Inherited from

`Object.valueOf`
