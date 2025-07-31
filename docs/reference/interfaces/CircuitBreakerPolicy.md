[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / CircuitBreakerPolicy

# Interface: CircuitBreakerPolicy

Defined in: [packages/core/src/services/model/config.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/config.ts#L34)

定义断路器策略

## Properties

### cooldownSeconds

> **cooldownSeconds**: `number`

Defined in: [packages/core/src/services/model/config.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/config.ts#L38)

断路器开启后的冷却时间 (秒)

***

### failureThreshold

> **failureThreshold**: `number`

Defined in: [packages/core/src/services/model/config.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/4e044b1ec2226c145f49107053f00a90b7003b02/packages/core/src/services/model/config.ts#L36)

触发断路的连续失败次数
