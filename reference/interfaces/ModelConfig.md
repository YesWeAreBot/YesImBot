[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelConfig

# Interface: ModelConfig

Defined in: [packages/core/src/services/model/config.ts:74](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L74)

## Properties

### abilities

> **abilities**: [`ModelAbility`](../enumerations/ModelAbility.md)[]

Defined in: [packages/core/src/services/model/config.ts:77](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L77)

***

### circuitBreakerPolicy?

> `optional` **circuitBreakerPolicy**: [`CircuitBreakerPolicy`](CircuitBreakerPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:89](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L89)

断路器策略

***

### modelId

> **modelId**: `string`

Defined in: [packages/core/src/services/model/config.ts:76](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L76)

***

### parameters?

> `optional` **parameters**: `object`

Defined in: [packages/core/src/services/model/config.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L78)

#### custom?

> `optional` **custom**: `object`[]

#### stream?

> `optional` **stream**: `boolean`

#### temperature?

> `optional` **temperature**: `number`

#### topP?

> `optional` **topP**: `number`

***

### providerName?

> `optional` **providerName**: `string`

Defined in: [packages/core/src/services/model/config.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L75)

***

### retryPolicy?

> `optional` **retryPolicy**: [`RetryPolicy`](RetryPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:87](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L87)

重试策略

***

### timeoutPolicy?

> `optional` **timeoutPolicy**: [`TimeoutPolicy`](TimeoutPolicy.md)

Defined in: [packages/core/src/services/model/config.ts:85](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/config.ts#L85)

超时策略
