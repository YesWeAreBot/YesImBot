import "reflect-metadata";
import { z } from "zod";
import { ToolDefinition, ExtensionMetadata, ToolMetadata, ExtensionDefinition } from "./types";
import { createTool, createExtension } from "./helpers";

// 元数据键
const EXTENSION_METADATA_KEY = Symbol("extension:metadata");
const TOOL_METADATA_KEY = Symbol("tool:metadata");
const PARAMS_METADATA_KEY = Symbol("params:metadata");

/**
 * 扩展类构造器接口
 */
export interface ExtensionConstructor {
    new (...args: any[]): any;
    getExtensionDefinition(): ExtensionDefinition;
}

/**
 * 扩展装饰器
 */
export function Extension(metadata: Omit<ExtensionMetadata, "name" | "version"> & { name?: string; version?: string }) {
    return function <T extends { new (...args: any[]): any }>(constructor: T): T & ExtensionConstructor {
        const extensionMetadata: ExtensionMetadata = {
            name: metadata.name || constructor.name,
            version: metadata.version || "1.0.0",
            description: metadata.description,
            author: metadata.author,
            homepage: metadata.homepage,
            repository: metadata.repository,
            license: metadata.license,
            keywords: metadata.keywords,
        };

        Reflect.defineMetadata(EXTENSION_METADATA_KEY, extensionMetadata, constructor);

        // 自动收集工具定义
        const prototype = constructor.prototype;
        const methodNames = Object.getOwnPropertyNames(prototype).filter(
            (name) => name !== "constructor" && typeof prototype[name] === "function"
        );

        const tools: ToolDefinition[] = [];

        for (const methodName of methodNames) {
            const toolMetadata: ToolMetadata | undefined = Reflect.getMetadata(TOOL_METADATA_KEY, prototype, methodName);
            const paramsSchema: z.ZodTypeAny | undefined = Reflect.getMetadata(PARAMS_METADATA_KEY, prototype, methodName);

            if (toolMetadata && paramsSchema) {
                tools.push(
                    createTool({
                        name: toolMetadata.name,
                        description: toolMetadata.description,
                        version: toolMetadata.version,
                        author: toolMetadata.author,
                        category: toolMetadata.category,
                        tags: toolMetadata.tags,
                        parameters: paramsSchema,
                        execute: async (params, context) => {
                            const instance = new constructor();
                            return await instance[methodName](params, context);
                        },
                    })
                );
            }
        }

        // 创建新的构造器类型，包含静态方法
        const ExtendedConstructor = class extends constructor {
            static getExtensionDefinition(): ExtensionDefinition {
                return createExtension({
                    metadata: {
                        name: extensionMetadata.name,
                        version: extensionMetadata.version,
                        description: extensionMetadata.description,
                        author: extensionMetadata.author,
                        homepage: extensionMetadata.homepage,
                        repository: extensionMetadata.repository,
                        license: extensionMetadata.license,
                        keywords: extensionMetadata.keywords,
                    },
                    tools,
                });
            }
        };

        // 保留原构造器的名称
        Object.defineProperty(ExtendedConstructor, "name", {
            value: constructor.name,
            configurable: true,
        });

        return ExtendedConstructor as T & ExtensionConstructor;
    };
}

/**
 * 工具装饰器
 */
export function Tool(nameOrConfig: string | Partial<ToolMetadata>) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const toolMetadata: ToolMetadata =
            typeof nameOrConfig === "string"
                ? {
                      name: nameOrConfig,
                      version: "1.0.0",
                      description: `工具 ${nameOrConfig}`,
                  }
                : {
                      name: nameOrConfig.name || propertyKey,
                      version: nameOrConfig.version || "1.0.0",
                      description: nameOrConfig.description || `工具 ${nameOrConfig.name || propertyKey}`,
                      author: nameOrConfig.author,
                      category: nameOrConfig.category,
                      tags: nameOrConfig.tags,
                  };

        Reflect.defineMetadata(TOOL_METADATA_KEY, toolMetadata, target, propertyKey);
    };
}

/**
 * 参数装饰器
 */
export function Params<T extends z.ZodTypeAny>(schema: T) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        Reflect.defineMetadata(PARAMS_METADATA_KEY, schema, target, propertyKey);
    };
}

/**
 * 获取扩展元数据
 */
export function getExtensionMetadata(constructor: any): ExtensionMetadata | undefined {
    return Reflect.getMetadata(EXTENSION_METADATA_KEY, constructor);
}

/**
 * 获取工具元数据
 */
export function getToolMetadata(target: any, propertyKey: string): ToolMetadata | undefined {
    return Reflect.getMetadata(TOOL_METADATA_KEY, target, propertyKey);
}

/**
 * 获取参数元数据
 */
export function getParamsMetadata(target: any, propertyKey: string): z.ZodTypeAny | undefined {
    return Reflect.getMetadata(PARAMS_METADATA_KEY, target, propertyKey);
}

/**
 * 工具类装饰器的便捷函数
 * 用于手动定义工具类而不使用装饰器
 */
export function defineExtensionClass<T extends { new (...args: any[]): any }>(
    constructor: T,
    metadata: ExtensionMetadata,
    toolConfigs: Array<{
        methodName: string;
        toolMetadata: ToolMetadata;
        paramsSchema: z.ZodTypeAny;
    }>
): T & ExtensionConstructor {
    const tools: ToolDefinition[] = [];

    for (const config of toolConfigs) {
        tools.push(
            createTool({
                name: config.toolMetadata.name,
                description: config.toolMetadata.description,
                version: config.toolMetadata.version,
                author: config.toolMetadata.author,
                category: config.toolMetadata.category,
                tags: config.toolMetadata.tags,
                parameters: config.paramsSchema,
                execute: async (params, context) => {
                    const instance = new constructor();
                    return await instance[config.methodName](params, context);
                },
            })
        );
    }

    const ExtendedConstructor = class extends constructor {
        static getExtensionDefinition(): ExtensionDefinition {
            return createExtension({
                metadata,
                tools,
            });
        }
    };

    Object.defineProperty(ExtendedConstructor, "name", {
        value: constructor.name,
        configurable: true,
    });

    return ExtendedConstructor as T & ExtensionConstructor;
}
