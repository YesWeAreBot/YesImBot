[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderFactoryRegistry

# Variable: ProviderFactoryRegistry

> `const` **ProviderFactoryRegistry**: `FactoryRegistry`

Defined in: [packages/core/src/services/model/factories.ts:184](https://github.com/YesWeAreBot/YesImBot/blob/fb48ed04032f4b5a158b252aad13c4c7a3ffb363/packages/core/src/services/model/factories.ts#L184)

全局唯一的提供商工厂注册实例。
新增 Provider 类型时，只需在此处调用 `ProviderFactoryRegistry.register(...)` 即可。
