import { Schema } from "koishi";
import "reflect-metadata";
import { createExtension, createTool } from "./helpers";
import {
    ExtensionConstructor,
    ExtensionDefinition,
    ExtensionMetadata,
    ToolDefinition,
    ToolMetadata
} from "./types";

// 元数据键
const EXTENSION_METADATA_KEY = Symbol("extension:metadata");
const TOOL_METADATA_KEY = Symbol("tool:metadata");
const PARAMS_METADATA_KEY = Symbol("params:metadata");

type ExtensionDecoratorMetadata<T extends Schema<any>> = Omit<ExtensionMetadata<T>, "name" | "version"> & {
    name?: string;
    version?: string;
};

/**
 * 扩展装饰器
 * @param metadata 扩展的元数据，可以包含Koishi schema作为配置定义
 */
export function Extension<TConfig extends Schema<any>>(metadata: ExtensionDecoratorMetadata<TConfig>) {
    return function <T extends { new (...args: any[]): any }>(constructor: T): T & ExtensionConstructor {
        const extensionMetadata: ExtensionMetadata<TConfig> = {
            name: metadata.name || constructor.name,
            version: metadata.version || "1.0.0",
            description: metadata.description,
            schema: metadata.schema,
            author: metadata.author,
            homepage: metadata.homepage,
            repository: metadata.repository,
            license: metadata.license,
            keywords: metadata.keywords,
        };

        Reflect.defineMetadata(EXTENSION_METADATA_KEY, extensionMetadata, constructor);

        // 使用 getter 来延迟工具的收集，确保所有方法装饰器都已运行
        const ExtendedConstructor = class extends constructor {
            static getExtensionDefinition(): ExtensionDefinition<TConfig> {
                const prototype = constructor.prototype;
                const methodNames = Object.getOwnPropertyNames(prototype).filter(
                    (name) => name !== "constructor" && typeof prototype[name] === "function"
                );

                const tools: ToolDefinition[] = [];

                for (const methodName of methodNames) {
                    const toolMetadata: ToolMetadata | undefined = Reflect.getMetadata(TOOL_METADATA_KEY, prototype, methodName);
                    const paramsSchema: Schema<any> | undefined = Reflect.getMetadata(PARAMS_METADATA_KEY, prototype, methodName);

                    if (toolMetadata && paramsSchema) {
                        tools.push(
                            createTool({
                                metadata: toolMetadata,
                                parameters: paramsSchema,
                                execute: async (params, context) => {
                                    // 在执行时创建实例，确保是最新状态
                                    const instance = new constructor();
                                    // 将完整的上下文传递给实例方法
                                    return await instance[methodName](params, context);
                                },
                            })
                        );
                    }
                }

                return createExtension({
                    metadata: extensionMetadata,
                    tools,
                });
            }
        };

        Object.defineProperty(ExtendedConstructor, "name", {
            value: constructor.name,
            configurable: true,
        });

        return ExtendedConstructor as T & ExtensionConstructor;
    };
}

/**
 * 工具装饰器
 * @param nameOrConfig 工具名称或部分元数据对象
 */
export function Tool(nameOrConfig: string | Partial<ToolMetadata>) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const toolMetadata: ToolMetadata =
            typeof nameOrConfig === "string"
                ? { name: nameOrConfig, description: `工具 ${nameOrConfig}` }
                : {
                      name: nameOrConfig.name || propertyKey,
                      description: nameOrConfig.description || `工具 ${nameOrConfig.name || propertyKey}`,
                      ...nameOrConfig,
                  };
        Reflect.defineMetadata(TOOL_METADATA_KEY, toolMetadata, target, propertyKey);
    };
}

/**
 * 参数装饰器
 * @param schema 工具参数的 Koishi schema
 */
export function Params<T extends Schema>(schema: T) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        Reflect.defineMetadata(PARAMS_METADATA_KEY, schema, target, propertyKey);
    };
}
