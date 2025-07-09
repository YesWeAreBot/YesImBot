// --- 装饰器定义 ---

import { Session } from "koishi";
import { ExtensionMetadata, Infer, ToolDefinition, ToolMetadata } from "./types";

/**
 * @Extension 类装饰器
 * 用于将元数据附加到扩展类的原型上。
 * @param metadata 扩展包的元数据对象
 */
export function Extension(metadata: ExtensionMetadata) {
    return function (target: any) {
        // target 是类的构造函数，将 metadata 附加到其 prototype 上
        // 这样，所有实例都能通过原型链访问到它
        target.prototype.metadata = metadata;
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
