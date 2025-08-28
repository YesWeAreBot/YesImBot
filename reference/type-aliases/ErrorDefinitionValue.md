[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ErrorDefinitionValue

# Type Alias: ErrorDefinitionValue

> **ErrorDefinitionValue** = `{ [K in ErrorDomains]: typeof ErrorDefinitions[K][keyof typeof ErrorDefinitions[K]] }`\[`ErrorDomains`\]

Defined in: [packages/core/src/shared/errors/index.ts:165](https://github.com/YesWeAreBot/YesImBot/blob/91c73ac8adc99fd9fe5ac1678a22415c1645dc09/packages/core/src/shared/errors/index.ts#L165)
