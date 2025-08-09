[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ErrorReporter

# Class: ErrorReporter

Defined in: [packages/core/src/shared/errors/index.ts:31](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/shared/errors/index.ts#L31)

负责格式化错误详情并将其上报到外部服务

## Constructors

### Constructor

> **new ErrorReporter**(`config`, `logger`): `ErrorReporter`

Defined in: [packages/core/src/shared/errors/index.ts:35](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/shared/errors/index.ts#L35)

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

Defined in: [packages/core/src/shared/errors/index.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/shared/errors/index.ts#L52)

格式化并上报错误

#### Parameters

##### context

[`ReportContext`](../interfaces/ReportContext.md)

包含错误和附加上下文的对象

#### Returns

`Promise`\<`void`\>
