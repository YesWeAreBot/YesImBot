[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / YesImBot

# Class: YesImBot

Defined in: [packages/core/src/index.ts:22](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L22)

## Extends

- `Service`\<`Config`\>

## Constructors

### Constructor

> **new YesImBot**(`ctx`, `config`): `YesImBot`

Defined in: [packages/core/src/index.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L33)

#### Parameters

##### ctx

`Context`

##### config

`Config`

#### Returns

`YesImBot`

#### Overrides

`Service<Config>.constructor`

## Properties

### config

> **config**: `Config`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:14

#### Inherited from

`Service.config`

***

### ctx

> `protected` **ctx**: `Context`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:12

#### Inherited from

`Service.ctx`

***

### ~~logger~~

> **logger**: `__module`

Defined in: node\_modules/cordis/lib/index.d.ts:19

#### Deprecated

use `this.ctx.logger` instead

#### Inherited from

`Service.logger`

***

### name

> **name**: `string`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:13

#### Inherited from

`Service.name`

***

### schema

> **schema**: `SchemaService`

Defined in: node\_modules/cordis/lib/index.d.ts:20

#### Inherited from

`Service.schema`

***

### Config

> `readonly` `static` **Config**: `Schema`\<`Config`\>

Defined in: [packages/core/src/index.ts:23](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L23)

***

### extend

> `readonly` `static` **extend**: *typeof* [`extend`](#extend)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:5

#### Inherited from

`Service.extend`

***

### immediate

> `readonly` `static` **immediate**: *typeof* [`immediate`](#immediate)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:8

#### Inherited from

`Service.immediate`

***

### inject

> `readonly` `static` **inject**: `object`

Defined in: [packages/core/src/index.ts:24](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L24)

#### optional

> **optional**: `string`[]

#### required

> **required**: `string`[]

***

### invoke

> `readonly` `static` **invoke**: *typeof* [`invoke`](#invoke)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:4

#### Inherited from

`Service.invoke`

***

### name

> `readonly` `static` **name**: `"yesimbot"` = `"yesimbot"`

Defined in: [packages/core/src/index.ts:28](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L28)

Returns the name of the function. Function names are read-only and can not be changed.

***

### provide

> `readonly` `static` **provide**: *typeof* [`provide`](#provide)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:7

#### Inherited from

`Service.provide`

***

### setup

> `readonly` `static` **setup**: *typeof* [`setup`](#setup)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:3

#### Inherited from

`Service.setup`

***

### tracker

> `readonly` `static` **tracker**: *typeof* [`tracker`](#tracker)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:6

#### Inherited from

`Service.tracker`

***

### usage

> `readonly` `static` **usage**: "\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。\n\n使用请阅读 \[文档\](https://docs.yesimbot.chat/) ，推荐使用 \[GPTGOD\](https://gptgod.online/#/register?invite\_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-2.5-pro-preview-06-05\n\`\n\n官方交流群：\[857518324\](http://qm.qq.com/cgi-bin/qm/qr?\_wv=1027&k=k3O5\_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group\_code=857518324)\n"

Defined in: [packages/core/src/index.ts:29](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/index.ts#L29)

## Methods

### \[extend\]()

> `protected` **\[extend\]**(`props?`): `any`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:20

#### Parameters

##### props?

`any`

#### Returns

`any`

#### Inherited from

`Service.[extend]`

***

### \[filter\]()

> `protected` **\[filter\]**(`ctx`): `boolean`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:18

#### Parameters

##### ctx

`Context`

#### Returns

`boolean`

#### Inherited from

`Service.[filter]`

***

### \[setup\]()

> **\[setup\]**(): `void`

Defined in: node\_modules/@koishijs/core/lib/index.d.ts:768

#### Returns

`void`

#### Inherited from

`Service.[setup]`

***

### fork()?

> `protected` `optional` **fork**(`ctx`, `config`): `void`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:11

#### Parameters

##### ctx

`Context`

##### config

`any`

#### Returns

`void`

#### Inherited from

`Service.fork`

***

### start()

> `protected` **start**(): `void` \| `Promise`\<`void`\>

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:9

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

`Service.start`

***

### stop()

> `protected` **stop**(): `void` \| `Promise`\<`void`\>

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:10

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

`Service.stop`

***

### \[hasInstance\]()

> `static` **\[hasInstance\]**(`instance`): `boolean`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:21

#### Parameters

##### instance

`any`

#### Returns

`boolean`

#### Inherited from

`Service.[hasInstance]`
