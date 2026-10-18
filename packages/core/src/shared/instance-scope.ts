import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { Context } from "koishi";

const unmanagedScopes = new WeakMap<object, string>();

export interface InstanceScopeOptions {
    /** Extensions can retain their own scope even when attached to a core. */
    owner?: Context;
    /** Durable consumers must never adopt the per-process fallback namespace. */
    requirePersistent?: boolean;
}

/**
 * Resolve the owning plugin, rather than an internal service or command context.
 * Persistent consumers must defer this until Loader has assigned the fork key
 * (startup/first use), rather than resolving paths inside plugin constructors.
 */
export function getInstanceScope(ctx: Context, warn?: (message: string) => void, options: InstanceScopeOptions = {}): string {
    const plugin = ctx.get?.("yesimbot");
    // Service.ctx is rebound to the caller by Cordis proxies. Its own descriptor
    // retains the original plugin context without undeclared property access.
    const owner: Context = options.owner ?? (plugin && Object.getOwnPropertyDescriptor(plugin, "ctx")?.value) ?? ctx;
    const keys: string[] = [];
    const seen = new Set<object>();
    let scope: any = owner.scope;
    while (scope && !seen.has(scope)) {
        seen.add(scope);
        const next = scope.parent?.scope;
        if (scope.key) keys.push(String(scope.key));
        else if (scope.runtime === scope && next !== scope) {
            // Loader stores the stable entry key on its ForkScope, while plugin
            // code runs in MainScope. Match the edge used by loader.paths().
            const children = scope.children ?? [];
            const keyed = children.filter((child: any) => typeof child.key === "string" && child.key);
            if (keyed.length === 1 && children.length === 1) keys.push(keyed[0].key);
            else if (keyed.length) {
                // A shared runtime with multiple forks cannot identify its owner.
                break;
            }
        }
        if (next === scope) break;
        scope = next;
    }
    let namespace: string;
    if (keys.length) namespace = JSON.stringify(keys.reverse());
    else {
        if (options.requirePersistent) throw new Error("未找到稳定插件实例标识，无法恢复持久任务");
        namespace = unmanagedScopes.get(owner)!;
        if (!namespace) {
            namespace = `unmanaged-${randomUUID()}`;
            unmanagedScopes.set(owner, namespace);
            warn?.("未找到持久化插件标识，实例日志使用独立临时标识，重启后不会自动恢复。旧共享目录保持原样。");
        }
    }
    return createHash("sha256").update(namespace).digest("hex").slice(0, 24);
}

/** A versioned entry point for consumers that require restart-stable ownership. */
export function getPersistentInstanceScope(ctx: Context, options: Pick<InstanceScopeOptions, "owner"> = {}): string {
    return getInstanceScope(ctx, undefined, { ...options, requirePersistent: true });
}

/** Legacy files at the root have no instance owner and must never be adopted. */
export function getInstanceDirectory(ctx: Context, directory: string, warn?: (message: string) => void, options: InstanceScopeOptions = {}): string {
    return path.join(path.resolve(ctx.baseDir, directory), "instances", getInstanceScope(ctx, warn, options));
}
