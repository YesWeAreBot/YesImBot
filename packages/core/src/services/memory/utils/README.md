# MemoryService 工具类文档

本目录包含了 MemoryService 使用的核心工具类，这些类提供了熔断器、锁管理、重试机制和性能监控等功能。

## 工具类概览

### 1. CircuitBreaker（熔断器）

熔断器是一种用于防止级联故障的设计模式。当服务出现故障时，熔断器会"打开"，阻止进一步的请求，从而保护系统免受过载。

**主要特性：**
- 三种状态：CLOSED（关闭）、OPEN（打开）、HALF_OPEN（半开）
- 自动故障检测和恢复
- 可配置的失败阈值和重置时间
- 详细的统计信息

**使用示例：**
```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,    // 失败阈值
  resetTimeoutMs: 60000,  // 重置超时时间
  monitoringPeriodMs: 30000 // 监控周期
});

const result = await breaker.execute(async () => {
  return await someRiskyOperation();
});
```

### 2. LockManager（锁管理器）

提供基于键的互斥锁功能，防止并发操作导致的数据竞争。

**主要特性：**
- 基于键的锁机制
- 超时保护，避免死锁
- 非阻塞锁尝试
- 锁统计和清理功能

**使用示例：**
```typescript
const lockManager = new LockManager();

const result = await lockManager.withLock('user_123', async () => {
  // 这里的代码在同一时间只能有一个实例执行
  return await updateUserProfile('user_123');
}, 30000); // 30秒超时
```

### 3. RetryManager（重试管理器）

提供灵活的重试机制，支持多种重试策略。

**重试策略：**
- **FIXED**：固定延迟
- **EXPONENTIAL**：指数退避
- **LINEAR**：线性增长

**使用示例：**
```typescript
const retryManager = new RetryManager({
  maxRetries: 3,
  baseDelayMs: 1000,
  strategy: RetryStrategy.EXPONENTIAL,
  maxDelayMs: 10000
});

const result = await retryManager.execute(async () => {
  return await someUnreliableOperation();
});
```

**预设配置：**
```typescript
// 快速重试：适用于网络抖动
RetryPresets.FAST

// 标准重试：适用于一般的服务调用
RetryPresets.STANDARD

// 慢速重试：适用于重要但不紧急的操作
RetryPresets.SLOW

// 数据库重试：适用于数据库操作
RetryPresets.DATABASE
```

### 4. PerformanceMonitor（性能监控器）

提供轻量级的性能监控功能，用于跟踪操作的执行时间、成功率、错误统计等关键指标。

**主要特性：**
- 操作计时和统计
- 成功率和错误率计算
- 缓存命中率统计
- 内存使用监控
- 自动清理过期数据

**使用示例：**
```typescript
const monitor = new PerformanceMonitor();

// 监控操作执行
const result = await monitor.track('user_profile_update', async () => {
  return await updateUserProfile(userId);
});

// 记录缓存命中
monitor.recordCacheHit('user_facts');
monitor.recordCacheMiss('user_facts');

// 获取统计信息
const stats = monitor.getStats();
```

## 在 MemoryService 中的集成

这些工具类在 MemoryService 中的集成方式：

```typescript
export class MemoryService extends Service {
    // 工具类实例
    private readonly lockManager: LockManager;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly retryManager: RetryManager;
    private readonly performanceMonitor: PerformanceMonitor;

    constructor(ctx: Context, config: MemoryConfig) {
        super(ctx, Services.Memory, true);
        
        // 初始化工具类
        this.lockManager = new LockManager(config.errorHandling.lockTimeoutMs);
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: config.errorHandling.circuitBreakerThreshold,
            resetTimeoutMs: config.errorHandling.circuitBreakerResetMs,
            monitoringPeriodMs: 60000
        });
        this.retryManager = new RetryManager(RetryPresets.STANDARD);
        this.performanceMonitor = new PerformanceMonitor();
    }

    // 使用锁和熔断器保护关键操作
    private async withLock<T>(
        lockKey: string,
        operation: () => Promise<T>,
        options: { timeoutMs?: number; enableCircuitBreaker?: boolean } = {}
    ): Promise<T> {
        const { timeoutMs = 30000, enableCircuitBreaker = true } = options;

        if (enableCircuitBreaker) {
            const breakerResult = await this.circuitBreaker.execute(async () => {
                const lockResult = await this.lockManager.withLock(lockKey, operation, timeoutMs);
                if (!lockResult.success) {
                    throw new Error(lockResult.error || '操作失败');
                }
                return lockResult.data!;
            });

            if (!breakerResult.success) {
                throw new Error(breakerResult.error || '操作失败');
            }
            return breakerResult.data!;
        } else {
            const lockResult = await this.lockManager.withLock(lockKey, operation, timeoutMs);
            if (!lockResult.success) {
                throw new Error(lockResult.error || '操作失败');
            }
            return lockResult.data!;
        }
    }

    // 使用性能监控器跟踪操作
    private async withPerformanceMonitoring<T>(
        operationName: string, 
        operation: () => Promise<T>
    ): Promise<T> {
        return this.performanceMonitor.track(operationName, operation);
    }
}
```

## 配置说明

这些工具类的配置通过 MemoryConfig 进行管理：

```typescript
interface MemoryConfig {
    errorHandling: {
        maxRetries: number;
        retryDelayMs: number;
        lockTimeoutMs: number;
        circuitBreakerThreshold: number;
        circuitBreakerResetMs: number;
    };
    caching: {
        enabled: boolean;
        profileCacheTtlMinutes: number;
        factsCacheTtlMinutes: number;
        maxCacheEntries: number;
        cleanupIntervalMinutes: number;
    };
}
```

## 最佳实践

1. **熔断器使用**：
   - 对外部服务调用使用熔断器
   - 设置合理的失败阈值和重置时间
   - 监控熔断器状态，及时处理故障

2. **锁管理**：
   - 使用有意义的锁键名
   - 设置合理的超时时间
   - 避免嵌套锁，防止死锁

3. **重试机制**：
   - 根据操作类型选择合适的重试策略
   - 设置最大重试次数，避免无限重试
   - 对幂等操作使用重试

4. **性能监控**：
   - 监控关键操作的性能
   - 定期检查统计数据
   - 根据监控结果优化系统性能

## 故障排查

当遇到问题时，可以通过以下方式获取诊断信息：

```typescript
// 获取熔断器状态
const breakerStats = circuitBreaker.getStats();

// 获取锁管理器状态
const lockStats = lockManager.getStats();

// 获取性能统计
const perfStats = performanceMonitor.getStats();
```

这些统计信息可以帮助识别系统瓶颈和故障点。
