// packages/core/src/lifecycle/index.ts

import { Context } from "koishi";
import { SystemError } from "./errors";

/**
 * 可释放资源接口
 */
export interface Disposable {
    dispose(): Promise<void> | void;
}

/**
 * 生命周期阶段
 */
export enum LifecyclePhase {
    CREATED = "created",
    INITIALIZING = "initializing",
    READY = "ready",
    STOPPING = "stopping",
    STOPPED = "stopped",
    DISPOSED = "disposed"
}

/**
 * 生命周期感知接口
 */
export interface LifecycleAware {
    onStart?(): Promise<void>;
    onStop?(): Promise<void>;
    onDispose?(): Promise<void>;
}

/**
 * 资源元数据
 */
export interface ResourceMetadata {
    id: string;
    name: string;
    type: ResourceType;
    priority: number; // 清理优先级，数字越大越先清理
    dependencies?: string[]; // 依赖的其他资源ID
    createdAt: Date;
    phase: LifecyclePhase;
}

/**
 * 资源类型
 */
export enum ResourceType {
    SERVICE = "service",
    TIMER = "timer",
    WATCHER = "watcher",
    CONNECTION = "connection",
    HANDLER = "handler",
    MIDDLEWARE = "middleware",
    EXTENSION = "extension",
    OTHER = "other"
}

/**
 * 资源包装器
 */
export class ManagedResource<T extends Disposable> implements Disposable {
    private disposed = false;
    private disposeCallbacks: Array<() => Promise<void> | void> = [];

    constructor(
        public readonly resource: T,
        public readonly metadata: ResourceMetadata
    ) {}

    /**
     * 添加释放回调
     */
    public onDispose(callback: () => Promise<void> | void): void {
        this.disposeCallbacks.push(callback);
    }

    /**
     * 释放资源
     */
    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // 执行所有回调
        for (const callback of this.disposeCallbacks) {
            try {
                await callback();
            } catch (error) {
                console.error(`Dispose callback error for resource ${this.metadata.name}:`, error);
            }
        }

        // 释放实际资源
        try {
            await this.resource.dispose();
        } catch (error) {
            throw new SystemError(
                `Failed to dispose resource: ${this.metadata.name}`,
                "RESOURCE_DISPOSE_ERROR",
                {
                    resourceId: this.metadata.id,
                    resourceType: this.metadata.type,
                    error: error instanceof Error ? error.message : String(error)
                }
            );
        }
    }

    /**
     * 检查是否已释放
     */
    public isDisposed(): boolean {
        return this.disposed;
    }
}

/**
 * 资源管理器
 */
export class ResourceManager implements Disposable {
    private resources = new Map<string, ManagedResource<any>>();
    private disposeOrder: string[] = [];
    private disposed = false;
    private readonly logger: any;

    constructor(private ctx: Context) {
        this.logger = ctx.logger("ResourceManager");

        // 监听 Koishi 的 dispose 事件
        ctx.on("dispose", () => {
            this.dispose();
        });
    }

    /**
     * 注册资源
     */
    public register<T extends Disposable>(
        resource: T,
        metadata: Omit<ResourceMetadata, "id" | "createdAt" | "phase">
    ): ManagedResource<T> {
        if (this.disposed) {
            throw new SystemError("Cannot register resource: ResourceManager is disposed");
        }

        const id = this.generateResourceId(metadata.name);
        const fullMetadata: ResourceMetadata = {
            ...metadata,
            id,
            createdAt: new Date(),
            phase: LifecyclePhase.CREATED
        };

        const managedResource = new ManagedResource(resource, fullMetadata);
        this.resources.set(id, managedResource);
        this.updateDisposeOrder();

        this.logger.debug(`Registered resource: ${metadata.name} (${metadata.type})`);

        return managedResource;
    }

    /**
     * 注册定时器
     */
    public registerTimer(
        callback: () => void,
        interval: number,
        name: string = "timer"
    ): string {
        const timer = setInterval(callback, interval);
        const timerResource: Disposable = {
            dispose: () => clearInterval(timer)
        };

        const managed = this.register(timerResource, {
            name,
            type: ResourceType.TIMER,
            priority: 100
        });

        return managed.metadata.id;
    }

    /**
     * 注册超时定时器
     */
    public registerTimeout(
        callback: () => void,
        delay: number,
        name: string = "timeout"
    ): string {
        const timeout = setTimeout(() => {
            callback();
            this.unregister(resourceId);
        }, delay);

        const timeoutResource: Disposable = {
            dispose: () => clearTimeout(timeout)
        };

        const managed = this.register(timeoutResource, {
            name,
            type: ResourceType.TIMER,
            priority: 100
        });

        const resourceId = managed.metadata.id;
        return resourceId;
    }

    /**
     * 注册文件监听器
     */
    public registerFileWatcher(
        path: string,
        callback: (eventType: string) => void,
        name: string = "file-watcher"
    ): string {
        const fs = require("fs");
        const watcher = fs.watch(path, callback);

        const watcherResource: Disposable = {
            dispose: () => watcher.close()
        };

        const managed = this.register(watcherResource, {
            name: `${name}:${path}`,
            type: ResourceType.WATCHER,
            priority: 90
        });

        return managed.metadata.id;
    }

    /**
     * 注册服务
     */
    public registerService<T extends Disposable & LifecycleAware>(
        service: T,
        name: string,
        dependencies?: string[]
    ): string {
        const serviceResource: Disposable = {
            dispose: async () => {
                if (service.onStop) {
                    await service.onStop();
                }
                if (service.onDispose) {
                    await service.onDispose();
                }
                await service.dispose();
            }
        };

        const managed = this.register(serviceResource, {
            name,
            type: ResourceType.SERVICE,
            priority: 50,
            dependencies
        });

        // 启动服务
        if (service.onStart) {
            service.onStart().catch(error => {
                this.logger.error(`Failed to start service ${name}:`, error);
            });
        }

        return managed.metadata.id;
    }

    /**
     * 获取资源
     */
    public get<T extends Disposable>(id: string): T | undefined {
        return this.resources.get(id)?.resource as T;
    }

    /**
     * 注销资源
     */
    public async unregister(id: string): Promise<void> {
        const resource = this.resources.get(id);
        if (!resource) {
            return;
        }

        try {
            await resource.dispose();
            this.resources.delete(id);
            this.updateDisposeOrder();
            this.logger.debug(`Unregistered resource: ${resource.metadata.name}`);
        } catch (error) {
            this.logger.error(`Failed to unregister resource ${id}:`, error);
            throw error;
        }
    }

    /**
     * 释放所有资源
     */
    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.logger.info("Starting resource cleanup...");

        const errors: Error[] = [];

        // 按照优先级顺序释放资源
        for (const id of this.disposeOrder) {
            const resource = this.resources.get(id);
            if (!resource || resource.isDisposed()) {
                continue;
            }

            try {
                this.logger.debug(`Disposing resource: ${resource.metadata.name}`);
                await resource.dispose();
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
                this.logger.error(`Failed to dispose resource ${resource.metadata.name}:`, error);
            }
        }

        this.resources.clear();
        this.disposeOrder = [];

        if (errors.length > 0) {
            throw new SystemError(
                `Failed to dispose ${errors.length} resources`,
                "RESOURCE_CLEANUP_ERROR",
                { errors: errors.map(e => e.message) }
            );
        }

        this.logger.info("Resource cleanup completed");
    }

    /**
     * 更新资源释放顺序
     */
    private updateDisposeOrder(): void {
        const resources = Array.from(this.resources.values());

        // 构建依赖图
        const dependencyGraph = new Map<string, Set<string>>();
        for (const resource of resources) {
            const deps = resource.metadata.dependencies || [];
            dependencyGraph.set(resource.metadata.id, new Set(deps));
        }

        // 拓扑排序
        const sorted = this.topologicalSort(dependencyGraph);

        // 按优先级和拓扑顺序排序
        sorted.sort((a, b) => {
            const resourceA = this.resources.get(a)!;
            const resourceB = this.resources.get(b)!;
            return resourceB.metadata.priority - resourceA.metadata.priority;
        });

        this.disposeOrder = sorted;
    }

    /**
     * 拓扑排序
     */
    private topologicalSort(graph: Map<string, Set<string>>): string[] {
        const visited = new Set<string>();
        const result: string[] = [];

        const visit = (node: string) => {
            if (visited.has(node)) return;
            visited.add(node);

            const deps = graph.get(node) || new Set();
            for (const dep of deps) {
                visit(dep);
            }

            result.push(node);
        };

        for (const node of graph.keys()) {
            visit(node);
        }

        return result;
    }

    /**
     * 生成资源ID
     */
    private generateResourceId(name: string): string {
        return `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取资源统计信息
     */
    public getStats(): Record<ResourceType, number> {
        const stats: Record<string, number> = {};

        for (const resource of this.resources.values()) {
            const type = resource.metadata.type;
            stats[type] = (stats[type] || 0) + 1;
        }

        return stats as Record<ResourceType, number>;
    }

    /**
     * 获取所有资源信息
     */
    public getAllResources(): ResourceMetadata[] {
        return Array.from(this.resources.values()).map(r => r.metadata);
    }

    /**
     * 检测资源泄露
     */
    public detectLeaks(maxAge: number = 3600000): ResourceMetadata[] {
        const now = Date.now();
        const leaks: ResourceMetadata[] = [];

        for (const resource of this.resources.values()) {
            const age = now - resource.metadata.createdAt.getTime();
            if (age > maxAge) {
                leaks.push(resource.metadata);
            }
        }

        return leaks;
    }
}

/**
 * 使用资源管理器的基类
 */
export abstract class ManagedService implements Disposable, LifecycleAware {
    protected resourceManager: ResourceManager;
    protected logger: any;
    private phase: LifecyclePhase = LifecyclePhase.CREATED;

    constructor(
        protected ctx: Context,
        protected name: string
    ) {
        this.resourceManager = new ResourceManager(ctx);
        this.logger = ctx.logger(name);
    }

    /**
     * 获取当前生命周期阶段
     */
    public getPhase(): LifecyclePhase {
        return this.phase;
    }

    /**
     * 设置生命周期阶段
     */
    protected setPhase(phase: LifecyclePhase): void {
        this.phase = phase;
        this.logger.debug(`Phase changed to: ${phase}`);
    }

    /**
     * 启动服务
     */
    public async onStart(): Promise<void> {
        this.setPhase(LifecyclePhase.INITIALIZING);
        await this.doStart();
        this.setPhase(LifecyclePhase.READY);
    }

    /**
     * 停止服务
     */
    public async onStop(): Promise<void> {
        this.setPhase(LifecyclePhase.STOPPING);
        await this.doStop();
        this.setPhase(LifecyclePhase.STOPPED);
    }

    /**
     * 释放资源
     */
    public async dispose(): Promise<void> {
        await this.resourceManager.dispose();
        this.setPhase(LifecyclePhase.DISPOSED);
    }

    /**
     * 实际的启动逻辑
     */
    protected abstract doStart(): Promise<void> | void;

    /**
     * 实际的停止逻辑
     */
    protected abstract doStop(): Promise<void> | void;
}

/**
 * 自动清理装饰器
 */
export function AutoCleanup(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args: any[]) {
        const resourceManager = this.resourceManager as ResourceManager;
        if (!resourceManager) {
            throw new SystemError("@AutoCleanup requires ResourceManager");
        }

        const cleanupTasks: Array<() => Promise<void> | void> = [];

        // 创建代理上下文，拦截资源创建
        const proxyContext = new Proxy(this, {
            get(target, prop) {
                if (prop === "registerTimer") {
                    return (callback: Function, interval: number) => {
                        const id = resourceManager.registerTimer(
                            callback as any,
                            interval,
                            `${propertyKey}_timer`
                        );
                        cleanupTasks.push(() => resourceManager.unregister(id));
                        return id;
                    };
                }
                // 添加更多资源类型的代理...
                return target[prop];
            }
        });

        try {
            return await originalMethod.apply(proxyContext, args);
        } catch (error) {
            // 出错时清理已创建的资源
            for (const cleanup of cleanupTasks) {
                try {
                    await cleanup();
                } catch (cleanupError) {
                    console.error("Cleanup error:", cleanupError);
                }
            }
            throw error;
        }
    };

    return descriptor;
}
