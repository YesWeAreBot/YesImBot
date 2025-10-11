import { Context, Schema } from "koishi";

import { Services } from "@/shared/constants";
import { ExtensionMetadata, ToolDefinition, ToolInvocation, ToolMetadata } from "./types";

type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Class decorator that turns a plain class into a Koishi-loadable tool extension.
 *
 * The decorator wraps the target class to perform automatic runtime registration with the tool
 * management service: it binds per-instance tool `execute` methods, registers the extension
 * on the Koishi `ready` event (using the instance config `enabled` flag), and unregisters it
 * on `dispose`. It also attaches the provided metadata to the wrapped prototype, preserves a
 * static `Config` if present, sets the wrapped class name to `metadata.name`, and ensures the
 * wrapped class declares the tool and logger services in its `inject` metadata.
 *
 * @param metadata - Extension package metadata used for registration (provides the extension name and related info)
 * @returns A class decorator that produces a wrapped extension class compatible with Koishi's tool service
 */
export function Extension(metadata: ExtensionMetadata): ClassDecorator {
    //@ts-ignore
    return <T extends Constructor>(TargetClass: T) => {
        // 定义一个继承自目标类的新类
        class WrappedExtension extends TargetClass {
            constructor(...args: any[]) {
                const ctx: Context = args[0];
                const config: any = args[1] || {};

                const logger = ctx.logger("[Extension]");

                // 默认启用，配置中明确禁用才跳过加载
                const enabled = !Object.hasOwn(config, "enabled") || config.enabled;

                super(ctx, config);

                const toolService = ctx[Services.Tool];
                if (toolService) {
                    // 关键步骤：处理工具的 `this` 绑定和 `extensionName` 注入
                    const protoTools: Map<string, ToolDefinition> | undefined = this.constructor.prototype.tools;
                    if (protoTools) {
                        // 为当前实例创建一个全新的 Map，避免实例间共享
                        const tools = new Map<string, ToolDefinition>();

                        // 遍历原型上的所有工具定义
                        for (const [name, tool] of protoTools.entries()) {
                            // 创建一个新工具对象，其 execute 方法通过 .bind(this) 永久绑定到当前实例
                            // 同时注入 extensionName
                            tools.set(
                                name,
                                Object.assign({}, tool, {
                                    execute: tool.execute.bind(this),
                                    extensionName: metadata.name, // 注入扩展名称
                                })
                            );
                        }

                        //@ts-ignore
                        this.tools = tools;
                    }

                    ctx.on("ready", () => {
                        //@ts-ignore
                        toolService.register(this, enabled, config);
                    });

                    ctx.on("dispose", () => {
                        if (toolService) {
                            toolService.unregister(metadata.name);
                        }
                    });
                } else {
                    logger.warn(`工具管理器服务未找到。扩展 "${metadata.name}" 将不会被加载。`);
                }
            }
        }

        // 复制静态属性
        // 使用 as any 来绕过 TypeScript 对直接修改静态属性的限制
        const TargetAsAny = TargetClass as any;
        const WrappedAsAny = WrappedExtension as any;

        WrappedAsAny.prototype.metadata = metadata;

        Object.defineProperty(WrappedAsAny, "name", {
            value: metadata.name,
            writable: false,
        });

        // 继承静态 Config
        if ("Config" in TargetAsAny) {
            Object.defineProperty(WrappedAsAny, "Config", {
                value: TargetAsAny.Config,
                writable: false,
            });
        }

        // 合并 inject 依赖
        const originalInjects = TargetAsAny.inject || [];

        if (Array.isArray(originalInjects)) {
            Object.defineProperty(WrappedAsAny, "inject", {
                value: [...new Set([...originalInjects, Services.Tool])], // deprecated Services.Logger
                writable: false,
            });
        } else {
            const required = originalInjects["required"] || [];
            originalInjects["required"] = [...new Set([...required, Services.Tool])]; // deprecated Services.Logger
            Object.defineProperty(WrappedAsAny, "inject", {
                value: originalInjects,
                writable: false,
            });
        }

        return WrappedExtension as unknown as T;
    };
}

/**
 * @Tool 方法装饰器
 * 用于将一个类方法声明为"工具"。
 * @param metadata 工具的元数据
 */
export function Tool<TParams>(metadata: Omit<ToolMetadata<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: TypedPropertyDescriptor<(params: TParams, invocation: ToolInvocation) => Promise<any>>
    ) {
        if (!descriptor.value) {
            return;
        }

        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition: ToolDefinition<any, TParams> = {
            name: metadata.name || propertyKey,
            description: metadata.description,
            parameters: metadata.parameters,
            execute: descriptor.value,
            supports: metadata.supports,
            activators: metadata.activators,
            workflow: metadata.workflow,
            type: "tool", // 默认类型为 tool
            extensionName: "", // 临时值，将在 Extension 装饰器中被覆盖
        };
        target.tools.set(toolDefinition.name, toolDefinition);
    };
}

/**
 * @Action 方法装饰器
 * 用于将一个类方法声明为"行动"。
 * @param metadata 工具的元数据
 */
export function Action<TParams>(metadata: Omit<ToolMetadata<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: TypedPropertyDescriptor<(params: TParams, invocation: ToolInvocation) => Promise<any>>
    ) {
        if (!descriptor.value) {
            return;
        }

        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition: ToolDefinition<any, TParams> = {
            name: metadata.name || propertyKey,
            description: metadata.description,
            parameters: metadata.parameters,
            execute: descriptor.value,
            supports: metadata.supports,
            activators: metadata.activators,
            workflow: metadata.workflow,
            type: "action", // 类型为 action
            extensionName: "", // 临时值，将在 Extension 装饰器中被覆盖
        };
        target.tools.set(toolDefinition.name, toolDefinition);
    };
}

export function withInnerThoughts(params: { [T: string]: Schema<any> }): Schema<any> {
    return Schema.object({
        inner_thoughts: Schema.string().description("Deep inner monologue private to you only."),
        ...params,
    });
}
