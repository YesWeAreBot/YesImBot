// --- 服务与管理 ---

import { Context, Service } from "koishi";
import { ToolServiceConfig } from "./config";
import { IExtension, ToolDefinition } from "./types";

type ExtensionConstructor = new (ctx: Context, config: any) => IExtension;

/**
 * ToolService
 * 负责注册、管理和提供所有扩展和工具。
 */
export class ToolService extends Service<ToolServiceConfig> {
    private tools: Map<string, ToolDefinition> = new Map();
    private extensions: Map<string, IExtension> = new Map();

    constructor(ctx: Context, config: ToolServiceConfig) {
        super(ctx, "tool");
    }

    /**
     * 注册一个新的扩展。
     * @param ExtConstructor 扩展的类（构造函数）
     * @param extConfig 传递给扩展实例的配置
     */
    public register(ExtConstructor: ExtensionConstructor, extConfig: any) {
        // 创建扩展实例。在这一步，BaseExtension 的构造函数会执行，完成所有绑定工作。
        const instance = new ExtConstructor(this.ctx, extConfig);

        if (!instance.metadata || !instance.metadata.name) {
            console.warn("一个扩展在注册时缺少元数据或名称，已跳过。");
            return;
        }

        console.log(`[ToolManager] 正在注册扩展: "${instance.metadata.name}"`);
        this.extensions.set(instance.metadata.name, instance);

        if (instance.tools) {
            for (const [name, tool] of instance.tools.entries()) {
                console.log(`  -> 注册工具: "${tool.name}"`);
                // 直接将工具存入管理器的 Map 中。
                // 无需再进行 .bind()，因为 BaseExtension 已经处理完毕。
                this.tools.set(name, tool);
            }
        }
    }

    public getExt(name: string): IExtension | undefined {
        return this.extensions.get(name);
    }

    public getTool(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }
}
