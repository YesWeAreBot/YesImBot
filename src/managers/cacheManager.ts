import fs from "fs";
import path from "path";
import zlib from "zlib";

import { Context } from "koishi";

export class CacheManager<T> {
  private ctx = new Context();
  private cache: Map<string, T>; // 内存缓存
  private isDirty: boolean; // 标记是否有需要保存的数据
  private saveImmediately: boolean;
  private throttledCommit: (() => void) & { dispose: () => void } | undefined;

  constructor(private filePath: string, private enableCompression = false) {
    this.cache = new Map<string, T>();
    this.isDirty = false;
    this.saveImmediately = true;

    this.loadCache();

    // 监听退出事件，确保退出前保存数据
    process.on("exit", this.commit.bind(this));
    process.on("beforeExit", this.commit.bind(this));
    process.on("SIGINT", this.handleExit.bind(this));
    process.on("SIGTERM", this.handleExit.bind(this));
  }

  serialize(value: T): string {
    if (value instanceof Map) {
      // 序列化 Map
      return JSON.stringify({ type: "Map", value: Array.from(value.entries()) });
    } else if (value instanceof Set) {
      // 序列化 Set
      return JSON.stringify({ type: "Set", value: Array.from(value) });
    } else if (value instanceof Date) {
      // 序列化 Date
      return JSON.stringify({ type: "Date", value: value.toISOString() });
    } else {
      // 默认使用 JSON 序列化
      return JSON.stringify(value);
    }
  }

  deserialize(serialized: string): T {
    const parsed = JSON.parse(serialized);
    if (parsed && parsed.type === "Map") {
      // 恢复 Map
      return new Map(parsed.value) as unknown as T;
    } else if (parsed && parsed.type === "Set") {
      // 恢复 Set
      return new Set(parsed.value) as unknown as T;
    } else if (parsed && parsed.type === "Date") {
      // 恢复 Date
      return new Date(parsed.value) as unknown as T;
    } else {
      // 默认返回原始对象
      return parsed as T;
    }
  }

  /**
   * 序列化并存储数据到文件
   * @returns
   */
  saveCache(): void {
    try {
      // 确保目标目录存在
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const serializedData = JSON.stringify(
        Array.from(this.cache.entries()).map(([key, value]) => [key, this.serialize(value)]),
        null,
        2
      );
      if (this.enableCompression) {
        const compressed = zlib.gzipSync(serializedData);
        fs.writeFileSync(this.filePath, compressed);
      } else {
        fs.writeFileSync(this.filePath, serializedData, "utf-8");
      }
    } catch (error) {
      logger.error("Failed to save cache:", error);
    }
  }


  /**
   * 反序列化并加载缓存数据
   * @returns
   */
  private loadCache(): void {
    try {
      // 如果文件不存在，创建文件并写入空数组
      if (!fs.existsSync(this.filePath)) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, this.enableCompression ? zlib.gzipSync("[]") : "[]", "utf-8");
        return;
      }

      let serializedData: string;

      // 如果启用了压缩
      if (this.enableCompression) {
        const compressed = fs.readFileSync(this.filePath); // 读取压缩文件
        const decompressed = zlib.unzipSync(compressed);   // 解压缩
        serializedData = decompressed.toString("utf-8");   // 转换为字符串
      } else {
        serializedData = fs.readFileSync(this.filePath, "utf-8"); // 直接读取文件内容
      }

      // 解析 JSON 数据
      const entries: [string, string][] = JSON.parse(serializedData || "[]");

      // 反序列化并加载到缓存中
      entries.forEach(([key, value]) => {
        this.cache.set(key, this.deserialize(value));
      });
    } catch (error) {
      if (error.code === "Z_DATA_ERROR") {
        logger.warn("缓存文件已损坏，将删除并重新创建。");
      }
      fs.unlinkSync(this.filePath);
      this.loadCache();
    }
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  public values(): T[] {
    return Array.from(this.cache.values());
  }

  public entries(): [string, T][] {
    return Array.from(this.cache.entries());
  }

  // 添加数据到缓存
  public set(key: string, value: T): void {
    this.cache.set(key, value);
    if (this.saveImmediately) {
      this.saveCache();
    } else {
      this.isDirty = true;
      this.throttledCommit?.();
    }
  }

  // 从缓存中获取数据
  public get(key: string): T | undefined {
    return this.cache.get(key);
  }

  // 移除缓存中的数据
  public remove(key: string): void {
    this.cache.delete(key);
    if (this.saveImmediately) {
      this.saveCache();
    } else {
      this.isDirty = true;
      this.throttledCommit?.();
    }
  }

  // 清空缓存
  public clear(): void {
    this.cache.clear();
    if (this.saveImmediately) {
      this.saveCache();
    } else {
      this.isDirty = true;
      this.throttledCommit?.();
    }
  }

  // 统一提交缓存到文件
  public commit(): void {
    if (this.isDirty) {
      this.saveCache();
      this.isDirty = false;
    }
  }

  // 使用throttle来替代定时器
  public setAutoSave(interval: number = 5000): void {
    if (interval <= 0) {
      this.saveImmediately = true;
      this.throttledCommit?.dispose();
      return;
    }

    this.saveImmediately = false;
    this.throttledCommit = this.ctx.throttle(this.commit.bind(this), interval);
  }

  private handleExit(): void {
    this.commit();
    this.throttledCommit?.dispose();
    process.exit(); // 确保进程退出
  }
}
