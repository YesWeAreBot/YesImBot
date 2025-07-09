// --- 装饰器定义 ---

import { Context, Session } from "koishi";
import { ExtensionMetadata, Infer, ToolDefinition, ToolMetadata } from "./types";
import { Services } from "../types";

/**
 * @Extension 类装饰器
 * 用于将元数据附加到扩展类的原型上。
 * @param metadata 扩展包的元数据对象
 */
export function Extension(metadata: ExtensionMetadata): ClassDecorator {
    return (TargetClass: any) => {
        // 1. 将元数据附加到类上，供后续使用
        TargetClass.prototype.metadata = metadata;

        // 2. 注入 Koishi 插件所需的静态 name 属性
        Object.defineProperty(TargetClass, "name", {
            value: metadata.name,
            writable: false,
        });

        // 3. 确保 inject 数组包含 toolManager
        const originalInjects = TargetClass.inject || [];
        TargetClass.inject = [...new Set([Services.Tool, ...originalInjects])];

        // 4. 改写类的构造函数 (Constructor)
        // const originalConstructor = TargetClass.prototype.constructor;

        // TargetClass.prototype.constructor = function (ctx: Context, config: any) {
        //     // a. 首先，调用用户自己编写的原始构造函数逻辑
        //     originalConstructor.apply(this, [ctx, config]);

        //     const toolService = ctx[Services.Tool];
        //     toolService.register(this, config);

        //     ctx.on("ready", async () => {
        //         // b. 然后，自动执行注册逻辑
        //         // 'this' 指向 MyWeatherExtension 的实例
        //         ctx.logger.info(`Tool Extension [${metadata.name}] loaded.`);
        //     });

        //     ctx.on("dispose", () => {
        //         toolService.unregister(metadata.name);
        //         ctx.logger.info(`Tool Extension [${metadata.name}] unloaded.`);
        //     });
        // };

        return TargetClass;
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
