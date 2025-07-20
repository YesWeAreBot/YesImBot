/**
 * 性能监控器
 * 
 * 提供轻量级的性能监控功能，用于跟踪操作的执行时间、
 * 成功率、错误统计等关键指标。
 * 
 * ## 功能特性
 * 
 * - 操作计时和统计
 * - 成功率和错误率计算
 * - 缓存命中率统计
 * - 内存使用监控
 * - 自动清理过期数据
 * 
 * ## 使用示例
 * 
 * ```typescript
 * const monitor = new PerformanceMonitor();
 * 
 * // 监控操作执行
 * const result = await monitor.track('user_profile_update', async () => {
 *   return await updateUserProfile(userId);
 * });
 * 
 * // 记录缓存命中
 * monitor.recordCacheHit('user_facts');
 * monitor.recordCacheMiss('user_facts');
 * 
 * // 获取统计信息
 * const stats = monitor.getStats();
 * console.log('操作统计:', stats.operations);
 * console.log('缓存统计:', stats.cache);
 * ```
 */

export interface OperationStats {
    name: string;
    count: number;
    successCount: number;
    errorCount: number;
    totalTimeMs: number;
    avgTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    successRate: number;
    lastExecutionTime: number;
}

export interface CacheStats {
    type: string;
    hits: number;
    misses: number;
    hitRate: number;
    totalRequests: number;
}

export interface PerformanceStats {
    operations: Record<string, OperationStats>;
    cache: Record<string, CacheStats>;
    memory: {
        heapUsed: number;
        heapTotal: number;
        external: number;
        rss: number;
    };
    uptime: number;
    startTime: number;
}

interface OperationRecord {
    name: string;
    startTime: number;
    endTime?: number;
    success?: boolean;
    error?: string;
    duration?: number;
}

interface CacheRecord {
    type: string;
    hits: number;
    misses: number;
}

export class PerformanceMonitor {
    private operations = new Map<string, OperationRecord[]>();
    private cache = new Map<string, CacheRecord>();
    private readonly startTime: number;
    private readonly maxRecords: number;
    private readonly cleanupIntervalMs: number;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(maxRecords: number = 1000, cleanupIntervalMs: number = 300000) {
        this.startTime = Date.now();
        this.maxRecords = maxRecords;
        this.cleanupIntervalMs = cleanupIntervalMs;
        this.startCleanupTimer();
    }

    /**
     * 跟踪操作执行
     */
    async track<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        const record: OperationRecord = {
            name: operationName,
            startTime: Date.now()
        };

        try {
            const result = await operation();
            record.endTime = Date.now();
            record.duration = record.endTime - record.startTime;
            record.success = true;
            
            this.recordOperation(record);
            return result;
        } catch (error) {
            record.endTime = Date.now();
            record.duration = record.endTime - record.startTime;
            record.success = false;
            record.error = error instanceof Error ? error.message : String(error);
            
            this.recordOperation(record);
            throw error;
        }
    }

    /**
     * 记录缓存命中
     */
    recordCacheHit(cacheType: string): void {
        const record = this.cache.get(cacheType) || { type: cacheType, hits: 0, misses: 0 };
        record.hits++;
        this.cache.set(cacheType, record);
    }

    /**
     * 记录缓存未命中
     */
    recordCacheMiss(cacheType: string): void {
        const record = this.cache.get(cacheType) || { type: cacheType, hits: 0, misses: 0 };
        record.misses++;
        this.cache.set(cacheType, record);
    }

    /**
     * 获取统计信息
     */
    getStats(): PerformanceStats {
        const operationStats: Record<string, OperationStats> = {};
        
        // 计算操作统计
        for (const [name, records] of this.operations.entries()) {
            const successRecords = records.filter(r => r.success === true);
            const errorRecords = records.filter(r => r.success === false);
            const durations = records.filter(r => r.duration !== undefined).map(r => r.duration!);
            
            operationStats[name] = {
                name,
                count: records.length,
                successCount: successRecords.length,
                errorCount: errorRecords.length,
                totalTimeMs: durations.reduce((sum, d) => sum + d, 0),
                avgTimeMs: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
                minTimeMs: durations.length > 0 ? Math.min(...durations) : 0,
                maxTimeMs: durations.length > 0 ? Math.max(...durations) : 0,
                successRate: records.length > 0 ? successRecords.length / records.length : 0,
                lastExecutionTime: records.length > 0 ? Math.max(...records.map(r => r.startTime)) : 0
            };
        }

        // 计算缓存统计
        const cacheStats: Record<string, CacheStats> = {};
        for (const [type, record] of this.cache.entries()) {
            const totalRequests = record.hits + record.misses;
            cacheStats[type] = {
                type,
                hits: record.hits,
                misses: record.misses,
                hitRate: totalRequests > 0 ? record.hits / totalRequests : 0,
                totalRequests
            };
        }

        // 获取内存使用情况
        const memUsage = process.memoryUsage();

        return {
            operations: operationStats,
            cache: cacheStats,
            memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                rss: memUsage.rss
            },
            uptime: Date.now() - this.startTime,
            startTime: this.startTime
        };
    }

    /**
     * 重置所有统计数据
     */
    reset(): void {
        this.operations.clear();
        this.cache.clear();
    }

    /**
     * 清理指定操作的统计数据
     */
    clearOperation(operationName: string): void {
        this.operations.delete(operationName);
    }

    /**
     * 清理指定缓存类型的统计数据
     */
    clearCache(cacheType: string): void {
        this.cache.delete(cacheType);
    }

    /**
     * 停止监控器
     */
    stop(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }

    private recordOperation(record: OperationRecord): void {
        const records = this.operations.get(record.name) || [];
        records.push(record);
        
        // 限制记录数量
        if (records.length > this.maxRecords) {
            records.splice(0, records.length - this.maxRecords);
        }
        
        this.operations.set(record.name, records);
    }

    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupIntervalMs);
    }

    private cleanup(): void {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时

        // 清理过期的操作记录
        for (const [name, records] of this.operations.entries()) {
            const validRecords = records.filter(r => now - r.startTime < maxAge);
            if (validRecords.length === 0) {
                this.operations.delete(name);
            } else {
                this.operations.set(name, validRecords);
            }
        }
    }
}
