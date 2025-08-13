[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelConfig

# Interface: ModelConfig

Defined in: [packages/core/src/services/model/config.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L75)

## Properties

### abilities

> **abilities**: [`ModelAbility`](../enumerations/ModelAbility.md)[]

Defined in: [packages/core/src/services/model/config.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L78)

***

### circuitBreakerPolicy?

> `optional` **circuitBreakerPolicy**: [`CircuitBreakerPolicy`](CircuitBreakerPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:90](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L90)

断路器策略

***

### modelId

> **modelId**: `string`

Defined in: [packages/core/src/services/model/config.ts:77](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L77)

***

### parameters?

> `optional` **parameters**: `object`

Defined in: [packages/core/src/services/model/config.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L79)

#### custom?

> `optional` **custom**: `object`

##### Index Signature

\[`key`: `string`\]: `object`

#### stream?

> `optional` **stream**: `boolean`

#### temperature?

> `optional` **temperature**: `number`

#### topP?

> `optional` **topP**: `number`

***

### providerName?

> `optional` **providerName**: `string`

Defined in: [packages/core/src/services/model/config.ts:76](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L76)

***

### retryPolicy?

> `optional` **retryPolicy**: [`RetryPolicy`](RetryPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:88](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L88)

重试策略

***

### timeoutPolicy?

> `optional` **timeoutPolicy**: [`TimeoutPolicy`](TimeoutPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:86](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/config.ts#L86)

超时策略
