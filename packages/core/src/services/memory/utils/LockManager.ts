/**
 * 锁管理器
 * 
 * 提供基于键的互斥锁功能，防止并发操作导致的数据竞争。
 * 支持超时机制，避免死锁问题。
 * 
 * ## 使用场景
 * 
 * - 防止同一用户的画像被并发更新
 * - 确保批处理操作的原子性
 * - 避免重复的维护任务执行
 * 
 * ## 使用示例
 * 
 * ```typescript
 * const lockManager = new LockManager();
 * 
 * // 使用锁保护关键操作
 * const result = await lockManager.withLock('user_123', async () => {
 *   // 这里的代码在同一时间只能有一个实例执行
 *   return await updateUserProfile('user_123');
 * }, 30000); // 30秒超时
 * 
 * if (result.success) {
 *   console.log('操作成功:', result.data);
 * } else {
 *   console.log('操作失败:', result.error);
 * }
 * ```
 */

export interface LockResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    lockAcquired: boolean;
    executionTimeMs?: number;
}

interface LockInfo {
    promise: Promise<void>;
    resolve: () => void;
    timestamp: number;
    timeoutId?: NodeJS.Timeout;
}

export class LockManager {
    private locks = new Map<string, LockInfo>();
    private readonly defaultTimeoutMs: number;

    constructor(defaultTimeoutMs: number = 30000) {
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    /**
     * 使用锁执行操作
     * @param key 锁的键
     * @param operation 要执行的操作
     * @param timeoutMs 超时时间（毫秒）
     * @returns 操作结果
     */
    async withLock<T>(
        key: string,
        operation: () => Promise<T>,
        timeoutMs: number = this.defaultTimeoutMs
    ): Promise<LockResult<T>> {
        const startTime = Date.now();
        let lockAcquired = false;

        try {
            // 尝试获取锁
            await this.acquireLock(key, timeoutMs);
            lockAcquired = true;

            // 执行操作
            const result = await operation();
            const executionTime = Date.now() - startTime;

            return {
                success: true,
                data: result,
                lockAcquired: true,
                executionTimeMs: executionTime
            };
        } catch (error) {
            const executionTime = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                lockAcquired,
                executionTimeMs: executionTime
            };
        } finally {
            if (lockAcquired) {
                this.releaseLock(key);
            }
        }
    }

    /**
     * 尝试获取锁（非阻塞）
     * @param key 锁的键
     * @returns 是否成功获取锁
     */
    tryLock(key: string): boolean {
        if (this.locks.has(key)) {
            return false;
        }

        this.createLock(key);
        return true;
    }

    /**
     * 检查锁是否存在
     * @param key 锁的键
     * @returns 锁是否存在
     */
    isLocked(key: string): boolean {
        return this.locks.has(key);
    }

    /**
     * 获取锁的统计信息
     */
    getStats() {
        const now = Date.now();
        const lockStats = Array.from(this.locks.entries()).map(([key, lock]) => ({
            key,
            ageMs: now - lock.timestamp,
            hasTimeout: !!lock.timeoutId
        }));

        return {
            activeLocks: this.locks.size,
            locks: lockStats
        };
    }

    /**
     * 清理所有锁（谨慎使用）
     */
    clearAllLocks(): void {
        for (const [key, lock] of this.locks.entries()) {
            if (lock.timeoutId) {
                clearTimeout(lock.timeoutId);
            }
            lock.resolve();
        }
        this.locks.clear();
    }

    /**
     * 清理超时的锁
     * @param maxAgeMs 最大存活时间
     */
    cleanupStaleLocks(maxAgeMs: number = 300000): number { // 默认5分钟
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, lock] of this.locks.entries()) {
            if (now - lock.timestamp > maxAgeMs) {
                this.releaseLock(key);
                cleanedCount++;
            }
        }

        return cleanedCount;
    }

    private async acquireLock(key: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const attemptLock = () => {
                if (!this.locks.has(key)) {
                    // 锁不存在，创建新锁
                    this.createLock(key);
                    resolve();
                } else {
                    // 锁已存在，等待释放
                    const existingLock = this.locks.get(key)!;
                    existingLock.promise.then(() => {
                        // 锁释放后重试
                        setImmediate(attemptLock);
                    });
                }
            };

            // 设置超时
            const timeoutId = setTimeout(() => {
                reject(new Error(`获取锁超时: ${key} (${timeoutMs}ms)`));
            }, timeoutMs);

            attemptLock();

            // 成功获取锁后清除超时
            const originalResolve = resolve;
            resolve = () => {
                clearTimeout(timeoutId);
                originalResolve();
            };
        });
    }

    private createLock(key: string): void {
        let resolve: () => void;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });

        const lockInfo: LockInfo = {
            promise,
            resolve: resolve!,
            timestamp: Date.now()
        };

        this.locks.set(key, lockInfo);
    }

    private releaseLock(key: string): void {
        const lock = this.locks.get(key);
        if (lock) {
            if (lock.timeoutId) {
                clearTimeout(lock.timeoutId);
            }
            lock.resolve();
            this.locks.delete(key);
        }
    }
}
