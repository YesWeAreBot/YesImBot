// =================================================================================
// #region 缓存管理相关类型和实现
// =================================================================================

/**
 * 缓存项接口
 */
interface CacheItem<T> {
    value: T;
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

/**
 * 缓存配置接口
 */
interface CacheConfig {
    ttl: number; // 生存时间（毫秒）
    maxSize: number; // 最大缓存项数量
}

/**
 * 缓存键前缀枚举
 */
export enum CacheKeyPrefix {
    USER_INFO = "user_info",
    CHANNEL_INFO = "channel_info",
    MEMBER_LIST = "member_list",
    ENTITY_INFO = "entity_info",
    USER_PROFILES = "user_profiles",
    RECALL_RESULTS = "recall_results",
}

/**
 * 通用缓存管理器
 * 实现 LRU + TTL 的缓存策略
 */
export class CacheManager {
    private readonly caches = new Map<CacheKeyPrefix, Map<string, CacheItem<any>>>();
    private readonly configs: Record<CacheKeyPrefix, CacheConfig> = {
        [CacheKeyPrefix.USER_INFO]: { ttl: 30 * 60 * 1000, maxSize: 1000 },
        [CacheKeyPrefix.CHANNEL_INFO]: { ttl: 15 * 60 * 1000, maxSize: 500 },
        [CacheKeyPrefix.MEMBER_LIST]: { ttl: 5 * 60 * 1000, maxSize: 200 },
        [CacheKeyPrefix.ENTITY_INFO]: { ttl: 60 * 60 * 1000, maxSize: 2000 },
        [CacheKeyPrefix.USER_PROFILES]: { ttl: 45 * 60 * 1000, maxSize: 1000 },
        [CacheKeyPrefix.RECALL_RESULTS]: { ttl: 2 * 60 * 1000, maxSize: 100 },
    };

    constructor() {
        // 初始化所有缓存
        Object.values(CacheKeyPrefix).forEach((prefix) => {
            this.caches.set(prefix, new Map());
        });
    }

    /**
     * 生成缓存键
     */
    private generateKey(prefix: CacheKeyPrefix, ...parts: string[]): string {
        return `${prefix}:${parts.join(":")}`;
    }

    /**
     * 获取缓存项
     */
    get<T>(prefix: CacheKeyPrefix, key: string): T | null {
        const cache = this.caches.get(prefix);
        if (!cache) return null;

        const fullKey = this.generateKey(prefix, key);
        const item = cache.get(fullKey);

        if (!item) return null;

        const config = this.configs[prefix];
        const now = Date.now();

        // 检查是否过期
        if (now - item.timestamp > config.ttl) {
            cache.delete(fullKey);
            return null;
        }

        // 更新访问信息
        item.accessCount++;
        item.lastAccessed = now;

        return item.value;
    }

    /**
     * 设置缓存项
     */
    set<T>(prefix: CacheKeyPrefix, key: string, value: T): void {
        const cache = this.caches.get(prefix);
        if (!cache) return;

        const config = this.configs[prefix];
        const fullKey = this.generateKey(prefix, key);
        const now = Date.now();

        // 如果缓存已满，执行 LRU 淘汰
        if (cache.size >= config.maxSize && !cache.has(fullKey)) {
            this.evictLRU(cache);
        }

        cache.set(fullKey, {
            value,
            timestamp: now,
            accessCount: 1,
            lastAccessed: now,
        });
    }

    /**
     * LRU 淘汰策略
     */
    private evictLRU(cache: Map<string, CacheItem<any>>): void {
        let oldestKey = "";
        let oldestTime = Date.now();

        for (const [key, item] of cache.entries()) {
            if (item.lastAccessed < oldestTime) {
                oldestTime = item.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }

    /**
     * 删除缓存项
     */
    delete(prefix: CacheKeyPrefix, key: string): void {
        const cache = this.caches.get(prefix);
        if (!cache) return;

        const fullKey = this.generateKey(prefix, key);
        cache.delete(fullKey);
    }

    /**
     * 清空指定前缀的所有缓存
     */
    clear(prefix: CacheKeyPrefix): void {
        const cache = this.caches.get(prefix);
        if (cache) {
            cache.clear();
        }
    }

    /**
     * 清理过期缓存
     */
    cleanupExpired(): void {
        const now = Date.now();

        for (const [prefix, cache] of this.caches.entries()) {
            const config = this.configs[prefix];
            const keysToDelete: string[] = [];

            for (const [key, item] of cache.entries()) {
                if (now - item.timestamp > config.ttl) {
                    keysToDelete.push(key);
                }
            }

            keysToDelete.forEach((key) => cache.delete(key));
        }
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): Record<CacheKeyPrefix, { size: number; hitRate?: number }> {
        const stats: Record<CacheKeyPrefix, { size: number; hitRate?: number }> = {} as any;

        for (const [prefix, cache] of this.caches.entries()) {
            stats[prefix] = {
                size: cache.size,
            };
        }

        return stats;
    }
}

// #endregion
