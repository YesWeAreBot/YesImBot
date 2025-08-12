[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / PromptService

# Class: PromptService

Defined in: [packages/core/src/services/prompt/service.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L33)

通用提示词构建服务

## Extends

- `Service`\<[`PromptServiceConfig`](../interfaces/PromptServiceConfig.md)\>

## Constructors

### Constructor

> **new PromptService**(`ctx`, `config`): `PromptService`

Defined in: [packages/core/src/services/prompt/service.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L41)

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

[`YesImBot`](YesImBot.md).[`logger`](YesImBot.md#logger)

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

Defined in: [packages/core/src/services/prompt/service.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L34)

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

### inject()

> **inject**(`name`, `priority`, `renderFn`): `void`

Defined in: [packages/core/src/services/prompt/service.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L79)

(供插件使用) 注入一个将自动添加到主提示词的片段。

#### Parameters

##### name

`string`

注入的唯一名称，用于标识和调试。

##### priority

`number`

优先级，数字越小越靠前。

##### renderFn

[`Snippet`](../type-aliases/Snippet.md)

渲染函数，返回一个字符串。其返回值可以包含其他占位符，将进行二次渲染。

#### Returns

`void`

***

### registerSnippet()

> **registerSnippet**(`key`, `snippetFn`): `void`

Defined in: [packages/core/src/services/prompt/service.ts:62](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L62)

注册一个核心动态片段 (Snippet)
用于构建作用域，通常由核心服务或高级插件使用。

#### Parameters

##### key

`string`

片段的唯一键 (e.g., "user.name")

##### snippetFn

[`Snippet`](../type-aliases/Snippet.md)

在渲染时执行以提供动态数据的函数

#### Returns

`void`

***

### registerTemplate()

> **registerTemplate**(`name`, `content`): `void`

Defined in: [packages/core/src/services/prompt/service.ts:94](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L94)

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

Defined in: [packages/core/src/services/prompt/service.ts:107](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L107)

渲染一个提示词模板

#### Parameters

##### templateName

`string`

要渲染的模板名称

##### initialScope

`Record`\<`string`, `any`\> = `{}`

用户在调用时传入的初始数据

#### Returns

`Promise`\<`string`\>

一个 Promise，解析为最终渲染好的提示词字符串

***

### renderRaw()

> **renderRaw**(`templateContent`, `initialScope`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/prompt/service.ts:123](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L123)

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

Defined in: [packages/core/src/services/prompt/service.ts:49](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L49)

#### Returns

`Promise`\<`void`\>

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/prompt/service.ts:54](https://github.com/YesWeAreBot/YesImBot/blob/84883fd2fc21bbfee3432860def8f1c66ac2ea76/packages/core/src/services/prompt/service.ts#L54)

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
