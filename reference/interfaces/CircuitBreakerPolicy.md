[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / CircuitBreakerPolicy

# Interface: CircuitBreakerPolicy

Defined in: [packages/core/src/services/model/config.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/fb48ed04032f4b5a158b252aad13c4c7a3ffb363/packages/core/src/services/model/config.ts#L33)

定义断路器策略

## Properties

### cooldownSeconds

> **cooldownSeconds**: `number`

Defined in: [packages/core/src/services/model/config.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/fb48ed04032f4b5a158b252aad13c4c7a3ffb363/packages/core/src/services/model/config.ts#L37)

断路器开启后的冷却时间 (秒)

***

### failureThreshold

> **failureThreshold**: `number`

Defined in: [packages/core/src/services/model/config.ts:35](https://github.com/YesWeAreBot/YesImBot/blob/fb48ed04032f4b5a158b252aad13c4c7a3ffb363/packages/core/src/services/model/config.ts#L35)

触发断路的连续失败次数
