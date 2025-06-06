/**
 * 服务标识符
 */
export const SERVICE_TOKENS = {
    CHAT_MODEL_SWITCHER: Symbol("ChatModelSwitcher"),
    IMAGE_PROCESSOR: Symbol("ImageProcessor"),
    SCENARIO_MANAGER: Symbol("ScenarioManager"),
    PROMPT_BUILDER: Symbol("PromptBuilder"),
    MIDDLEWARE_MANAGER: Symbol("MiddlewareManager"),
    TOOL_MANAGER: Symbol("ToolManager"),
    MEMORY_SERVICE: Symbol("MemoryService"),
    MODEL_SERVICE: Symbol("ModelService"),
} as const;

export type ServiceToken = (typeof SERVICE_TOKENS)[keyof typeof SERVICE_TOKENS];

/**
 * 服务容器接口
 */
export interface IServiceContainer {
    register<T>(token: ServiceToken, factory: () => T): void;
    get<T>(token: ServiceToken): T;
    has(token: ServiceToken): boolean;
}

/**
 * 服务容器实现
 */
export class ServiceContainer implements IServiceContainer {
    private services = new Map<ServiceToken, any>();
    private factories = new Map<ServiceToken, () => any>();

    register<T>(token: ServiceToken, factory: () => T): void {
        this.factories.set(token, factory);
    }

    get<T>(token: ServiceToken): T {
        if (!this.services.has(token)) {
            const factory = this.factories.get(token);
            if (!factory) {
                throw new Error(`服务未注册: ${token.toString()}`);
            }
            this.services.set(token, factory());
        }
        return this.services.get(token);
    }

    has(token: ServiceToken): boolean {
        return this.factories.has(token);
    }

    /**
     * 清理所有服务
     */
    dispose(): void {
        this.services.clear();
        this.factories.clear();
    }
}
