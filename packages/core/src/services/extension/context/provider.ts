// ============================================================================
// TOOL CONTEXT PROVIDER
// ============================================================================

import { ToolContext, ContextCapability, ContextCapabilityMap } from "../types";

/**
 * Default implementation of ToolContext.
 * Provides capability-based access to execution context.
 */
export class ToolContextProvider implements ToolContext {
    private capabilities = new Map<ContextCapability, any>();

    constructor(initialContext?: Partial<ContextCapabilityMap>) {
        if (initialContext) {
            for (const [key, value] of Object.entries(initialContext)) {
                if (value !== undefined) {
                    this.capabilities.set(key as ContextCapability, value);
                }
            }
        }
    }

    has<K extends ContextCapability>(capability: K): boolean {
        return this.capabilities.has(capability);
    }

    get<K extends ContextCapability>(capability: K): ContextCapabilityMap[K] | undefined {
        return this.capabilities.get(capability);
    }

    getOrDefault<K extends ContextCapability>(capability: K, defaultValue: ContextCapabilityMap[K]): ContextCapabilityMap[K] {
        return this.capabilities.get(capability) ?? defaultValue;
    }

    getMany<K extends ContextCapability>(...capabilities: K[]): Partial<Pick<ContextCapabilityMap, K>> {
        const result: any = {};
        for (const cap of capabilities) {
            const value = this.capabilities.get(cap);
            if (value !== undefined) {
                result[cap] = value;
            }
        }
        return result;
    }

    require<K extends ContextCapability>(capability: K): ContextCapabilityMap[K] {
        const value = this.capabilities.get(capability);
        if (value === undefined) {
            throw new Error(`Required context capability not available: ${capability}`);
        }
        return value;
    }

    /**
     * Builder method for adding capabilities.
     */
    set<K extends ContextCapability>(capability: K, value: ContextCapabilityMap[K]): this {
        this.capabilities.set(capability, value);
        return this;
    }
}
