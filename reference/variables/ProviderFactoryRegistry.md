[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderFactoryRegistry

# Variable: ProviderFactoryRegistry

> `const` **ProviderFactoryRegistry**: `FactoryRegistry`

Defined in: [packages/core/src/services/model/factories.ts:377](https://github.com/YesWeAreBot/YesImBot/blob/91c73ac8adc99fd9fe5ac1678a22415c1645dc09/packages/core/src/services/model/factories.ts#L377)

全局唯一的提供商工厂注册实例。
新增 Provider 类型时，只需在此处调用 `ProviderFactoryRegistry.register(...)` 即可。
