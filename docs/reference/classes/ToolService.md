[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ToolService

# Class: ToolService

Defined in: [packages/core/src/services/extension/service.ts:25](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L25)

ToolService
负责注册、管理和提供所有扩展和工具。

## Extends

- `Service`\<[`ToolServiceConfig`](../interfaces/ToolServiceConfig.md)\>

## Constructors

### Constructor

> **new ToolService**(`ctx`, `config`): `ToolService`

Defined in: [packages/core/src/services/extension/service.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L33)

#### Parameters

##### ctx

`Context`

##### config

[`ToolServiceConfig`](../interfaces/ToolServiceConfig.md)

#### Returns

`ToolService`

#### Overrides

`Service<ToolServiceConfig>.constructor`

## Properties

### config

> **config**: [`ToolServiceConfig`](../interfaces/ToolServiceConfig.md)

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

Defined in: [packages/core/src/services/extension/service.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L26)

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

### getAvailableTools()

> **getAvailableTools**(`session?`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<`any`\>[]

Defined in: [packages/core/src/services/extension/service.ts:509](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L509)

#### Parameters

##### session?

`Session`

#### Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`any`\>[]

***

### getExtension()

> **getExtension**(`name`): [`IExtension`](../interfaces/IExtension.md)\<`any`\>

Defined in: [packages/core/src/services/extension/service.ts:518](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L518)

#### Parameters

##### name

`string`

#### Returns

[`IExtension`](../interfaces/IExtension.md)\<`any`\>

***

### getSchema()

> **getSchema**(`name`, `session?`): [`ToolSchema`](../interfaces/ToolSchema.md)

Defined in: [packages/core/src/services/extension/service.ts:529](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L529)

根据工具名称获取其 schema。
如果工具在当前会话中不可用，则返回 undefined。

#### Parameters

##### name

`string`

工具名称

##### session?

`Session`

可选的会话对象

#### Returns

[`ToolSchema`](../interfaces/ToolSchema.md)

工具的 Schema 或 undefined

***

### getTool()

> **getTool**(`name`, `session?`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<`any`\>

Defined in: [packages/core/src/services/extension/service.ts:499](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L499)

#### Parameters

##### name

`string`

##### session?

`Session`

#### Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`any`\>

***

### getToolSchemas()

> **getToolSchemas**(`session?`): [`ToolSchema`](../interfaces/ToolSchema.md)[]

Defined in: [packages/core/src/services/extension/service.ts:539](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L539)

获取在当前会话中所有可用工具的 Schema 列表。

#### Parameters

##### session?

`Session`

可选的会话对象

#### Returns

[`ToolSchema`](../interfaces/ToolSchema.md)[]

可用工具的 Schema 数组

***

### invoke()

> **invoke**(`functionName`, `params`, `session?`): `Promise`\<[`ToolCallResult`](../interfaces/ToolCallResult.md)\<`any`\>\>

Defined in: [packages/core/src/services/extension/service.ts:438](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L438)

#### Parameters

##### functionName

`string`

##### params

`Record`\<`string`, `unknown`\>

##### session?

`Session`

#### Returns

`Promise`\<[`ToolCallResult`](../interfaces/ToolCallResult.md)\<`any`\>\>

***

### register()

> **register**(`extensionInstance`, `enabled`, `extConfig`): `void`

Defined in: [packages/core/src/services/extension/service.ts:355](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L355)

注册一个新的扩展。

#### Parameters

##### extensionInstance

[`IExtension`](../interfaces/IExtension.md)

##### enabled

`boolean`

是否启用此扩展

##### extConfig

`any`

传递给扩展实例的配置

#### Returns

`void`

***

### registerTool()

> **registerTool**(`definition`): `void`

Defined in: [packages/core/src/services/extension/service.ts:430](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L430)

#### Parameters

##### definition

[`ToolDefinition`](../interfaces/ToolDefinition.md)

#### Returns

`void`

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/extension/service.ts:40](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L40)

#### Returns

`Promise`\<`void`\>

#### Overrides

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

### unregister()

> **unregister**(`name`): `boolean`

Defined in: [packages/core/src/services/extension/service.ts:411](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L411)

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### unregisterTool()

> **unregisterTool**(`name`): `boolean`

Defined in: [packages/core/src/services/extension/service.ts:434](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/extension/service.ts#L434)

#### Parameters

##### name

`string`

#### Returns

`boolean`

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
