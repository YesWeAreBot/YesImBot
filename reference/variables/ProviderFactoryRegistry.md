[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderFactoryRegistry

# Variable: ProviderFactoryRegistry

> `const` **ProviderFactoryRegistry**: `FactoryRegistry`

Defined in: [packages/core/src/services/model/factories.ts:184](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/factories.ts#L184)

全局唯一的提供商工厂注册实例。
新增 Provider 类型时，只需在此处调用 `ProviderFactoryRegistry.register(...)` 即可。
