[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderFactoryRegistry

# Variable: ProviderFactoryRegistry

> `const` **ProviderFactoryRegistry**: `FactoryRegistry`

Defined in: [packages/core/src/services/model/factories.ts:184](https://github.com/YesWeAreBot/YesImBot/blob/2c0b849e1b01cb678f12859500d1a620208078e8/packages/core/src/services/model/factories.ts#L184)

全局唯一的提供商工厂注册实例。
新增 Provider 类型时，只需在此处调用 `ProviderFactoryRegistry.register(...)` 即可。
