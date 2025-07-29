[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / PromptService

# Class: PromptService

Defined in: [packages/core/src/services/prompt/service.ts:24](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L24)

通用提示词构建服务

## Extends

- `Service`\<[`PromptServiceConfig`](../interfaces/PromptServiceConfig.md)\>

## Constructors

### Constructor

> **new PromptService**(`ctx`, `config`): `PromptService`

Defined in: [packages/core/src/services/prompt/service.ts:31](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L31)

#### Parameters

##### ctx

`Context`

##### config

[`PromptServiceConfig`](../interfaces/PromptServiceConfig.md)

#### Returns

`PromptService`

#### Overrides

`Service<PromptServiceConfig>.constructor`

## Properties

### config

> **config**: [`PromptServiceConfig`](../interfaces/PromptServiceConfig.md)

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

[`YesImBot`](YesImBot.md).[`name`](YesImBot.md#name)

***

### schema

> **schema**: `SchemaService`

Defined in: node\_modules/cordis/lib/index.d.ts:20

#### Inherited from

[`YesImBot`](YesImBot.md).[`schema`](YesImBot.md#schema)

***

### extend

> `readonly` `static` **extend**: *typeof* [`extend`](YesImBot.md#extend)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:5

#### Inherited from

`Service.extend`

***

### immediate

> `readonly` `static` **immediate**: *typeof* [`immediate`](YesImBot.md#immediate)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:8

#### Inherited from

`Service.immediate`

***

### inject

> `readonly` `static` **inject**: [`Services`](../enumerations/Services.md)[]

Defined in: [packages/core/src/services/prompt/service.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L25)

***

### invoke

> `readonly` `static` **invoke**: *typeof* [`invoke`](YesImBot.md#invoke)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:4

#### Inherited from

`Service.invoke`

***

### provide

> `readonly` `static` **provide**: *typeof* [`provide`](YesImBot.md#provide)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:7

#### Inherited from

`Service.provide`

***

### setup

> `readonly` `static` **setup**: *typeof* [`setup`](YesImBot.md#setup)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:3

#### Inherited from

`Service.setup`

***

### tracker

> `readonly` `static` **tracker**: *typeof* [`tracker`](YesImBot.md#tracker)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:6

#### Inherited from

`Service.tracker`

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

### registerSnippet()

> **registerSnippet**(`key`, `snippetFn`): `void`

Defined in: [packages/core/src/services/prompt/service.ts:104](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L104)

注册一个动态片段 (Snippet)

#### Parameters

##### key

`string`

片段的唯一键 (e.g., "user.name", "tools.availableList.json")

##### snippetFn

[`Snippet`](../type-aliases/Snippet.md)

在渲染时执行以提供动态数据的函数

#### Returns

`void`

***

### registerTemplate()

> **registerTemplate**(`name`, `content`): `void`

Defined in: [packages/core/src/services/prompt/service.ts:92](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L92)

注册一个提示词模板

#### Parameters

##### name

`string`

模板的唯一名称 (e.g., "agent.chat.system")

##### content

`string`

包含占位符的模板字符串

#### Returns

`void`

***

### render()

> **render**(`templateName`, `initialScope`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/prompt/service.ts:117](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L117)

渲染一个提示词模板

#### Parameters

##### templateName

`string`

要渲染的模板名称

##### initialScope

`Record`\<`string`, `any`\> = `{}`

用户在调用时传入的初始数据 (e.g., { query: "How to use TypeScript?" })

#### Returns

`Promise`\<`string`\>

一个 Promise，解析为最终渲染好的提示词字符串

***

### renderRaw()

> **renderRaw**(`templateContent`, `initialScope`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/prompt/service.ts:139](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L139)

渲染一个原始的模板字符串，不经过注册

#### Parameters

##### templateContent

`string`

##### initialScope

`Record`\<`string`, `any`\> = `{}`

#### Returns

`Promise`\<`string`\>

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/prompt/service.ts:40](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L40)

#### Returns

`Promise`\<`void`\>

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/prompt/service.ts:83](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/prompt/service.ts#L83)

#### Returns

`Promise`\<`void`\>

#### Overrides

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
