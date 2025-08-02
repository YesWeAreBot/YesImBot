[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / CircuitBreakerPolicy

# Interface: CircuitBreakerPolicy

Defined in: [packages/core/src/services/model/config.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/config.ts#L34)

定义断路器策略

## Properties

### cooldownSeconds

> **cooldownSeconds**: `number`

Defined in: [packages/core/src/services/model/config.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/config.ts#L38)

断路器开启后的冷却时间 (秒)

***

### failureThreshold

> **failureThreshold**: `number`

Defined in: [packages/core/src/services/model/config.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/config.ts#L36)

触发断路的连续失败次数
