[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ErrorReporter

# Class: ErrorReporter

Defined in: [packages/core/src/shared/errors/index.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/shared/errors/index.ts#L34)

负责格式化错误详情并将其上报到外部服务。
设计灵感来源于您提供的 ErrorHandlingMiddleware。

## Constructors

### Constructor

> **new ErrorReporter**(`config`, `logger`): `ErrorReporter`

Defined in: [packages/core/src/shared/errors/index.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/shared/errors/index.ts#L38)

#### Parameters

##### config

[`ErrorReporterConfig`](../interfaces/ErrorReporterConfig.md)

##### logger

`__module`

#### Returns

`ErrorReporter`

## Methods

### report()

> **report**(`context`): `Promise`\<`void`\>

Defined in: [packages/core/src/shared/errors/index.ts:55](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/shared/errors/index.ts#L55)

格式化并上报错误。

#### Parameters

##### context

[`ReportContext`](../interfaces/ReportContext.md)

包含错误和附加上下文的对象

#### Returns

`Promise`\<`void`\>
