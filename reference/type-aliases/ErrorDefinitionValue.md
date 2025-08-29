[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ErrorDefinitionValue

# Type Alias: ErrorDefinitionValue

> **ErrorDefinitionValue** = `{ [K in ErrorDomains]: typeof ErrorDefinitions[K][keyof typeof ErrorDefinitions[K]] }`\[`ErrorDomains`\]

Defined in: [packages/core/src/shared/errors/index.ts:165](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/shared/errors/index.ts#L165)
