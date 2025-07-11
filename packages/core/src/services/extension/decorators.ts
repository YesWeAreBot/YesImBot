import { Context, Session } from "koishi";

import { Services } from "@/services/types";
import { ExtensionMetadata, Infer, ToolDefinition, ToolMetadata } from "./types";

// 定义一个更精确的类型，表示任何可以被 new 的类
type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * @Extension 类装饰器
 * 将一个普通类转换为功能完备、可被 Koishi 直接加载的工具扩展插件。
 * @param metadata 扩展包的元数据对象
 */
export function Extension(metadata: ExtensionMetadata): ClassDecorator {
    //@ts-ignore
    return <T extends Constructor>(TargetClass: T) => {
        // 定义一个继承自目标类的新类
        class WrappedExtension extends TargetClass {
            constructor(...args: any[]) {
                super(...args);
                const ctx: Context = args[0];
                const config: any = args[1];

                const logger = ctx[Services.Logger].getLogger(`[工具管理器]`);

                // 默认启用，因此配置中明确禁用才跳过加载
                const enabled = !Object.hasOwn(config, "enabled") || config.enabled;

                // 在原始构造函数执行完毕后，执行自动注册逻辑。
                // 'this' 在这里是完全初始化好的、用户类的实例。
                const toolService = ctx[Services.Tool];
                if (toolService) {
                    // 关键步骤：处理工具的 `this` 绑定
                    const protoTools: Map<string, ToolDefinition> | undefined = this.constructor.prototype.tools;
                    if (protoTools) {
                        // 为当前实例创建一个全新的 Map，避免实例间共享
                        const tools = new Map<string, ToolDefinition>();

                        // 遍历原型上的所有工具定义
                        for (const [name, tool] of protoTools.entries()) {
                            // 创建一个新工具对象，其 execute 方法通过 .bind(this) 永久绑定到当前实例
                            tools.set(name, Object.assign({}, tool, { execute: tool.execute.bind(this) }));
                        }

                        //@ts-ignore
                        this.tools = tools;
                    }

                    ctx.on("ready", () => {
                        const toolService = ctx[Services.Tool];
                        //@ts-ignore
                        toolService.register(this, enabled, config.config);
                    });

                    ctx.on("dispose", () => {
                        const toolService = ctx[Services.Tool];
                        if (toolService) {
                            toolService.unregister(metadata.name);
                            logger.info(`扩展 "${metadata.name}" 已卸载。`);
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

        Object.defineProperty(TargetClass, "name", {
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

        Object.defineProperty(WrappedAsAny, "inject", {
            value: [...new Set([Services.Tool, ...originalInjects])],
            writable: false,
        });

        return WrappedExtension as unknown as T;
    };
}

/**
 * @Tool 方法装饰器
 * 用于将一个类方法声明为"工具"。
 * @param metadata 工具的元数据
 */
export function Tool<TParams>(metadata: ToolMetadata<TParams>) {
    return function (target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<(args: Infer<TParams>) => Promise<any>>) {
        if (!descriptor.value) {
            return;
        }

        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition: ToolDefinition<TParams> = {
            name: metadata.name || propertyKey,
            description: metadata.description,
            parameters: metadata.parameters,
            execute: descriptor.value,
        };
        target.tools.set(toolDefinition.name, toolDefinition);
    };
}

/**
 * @Support 方法装饰器
 * 用于指定工具是否在特定会话中可用。
 * @param predicate
 * @returns
 */
export function Support(predicate: (session: Session) => boolean) {
    return function (target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<(args: any) => Promise<any>>) {
        if (!descriptor.value) {
            return;
        }

        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition = target.tools.get(propertyKey);
        if (toolDefinition) {
            toolDefinition.isSupported = predicate;
        }
    };
}
