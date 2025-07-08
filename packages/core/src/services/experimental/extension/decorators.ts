// --- 装饰器定义 ---

import { ExtensionMetadata, Infer, ToolDefinition, ToolMetadata } from "./types";

/**
 * @Extension 类装饰器
 * 用于将元数据附加到扩展类的原型上。
 * @param metadata 扩展包的元数据对象
 */
export function Extension(metadata: ExtensionMetadata) {
    return function (target: any) {
        // target 是类的构造函数，我们将 metadata 附加到其原型 (prototype) 上
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

        // target 是类的原型。我们在这里初始化或获取原型上的 tools Map。
        // 注意：这个 Map 在所有实例之间是共享的，但我们会在 BaseExtension 中解决这个问题。
        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition: ToolDefinition<TParams> = {
            name: metadata.name || propertyKey,
            description: metadata.description,
            parameters: metadata.parameters,
            execute: descriptor.value, // 此时的 execute 方法是未绑定 this 的
        };
        target.tools.set(toolDefinition.name, toolDefinition);
    };
}
