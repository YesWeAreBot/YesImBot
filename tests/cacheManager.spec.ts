import fs from "fs";
import path from "path";
import zlib from "zlib";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import { CacheManager } from "../src/managers/cacheManager";

globalThis.logger = console;

describe("CacheManager", () => {
  let cacheManager: CacheManager<any>;
  const testFilePath = path.join(__dirname, "tmp", "test.cache.json");
  const testFilePathGzip = path.join(__dirname, "tmp", "test.cache.json.gz");

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (fs.existsSync(testFilePathGzip)) {
      fs.unlinkSync(testFilePathGzip);
    }
  });

  // 清理测试文件
  afterAll(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (fs.existsSync(testFilePathGzip)) {
      fs.unlinkSync(testFilePathGzip);
    }
    fs.rmdirSync(path.join(__dirname, "tmp"), { recursive: true });
  });

  describe("基本功能测试", () => {
    beforeEach(() => {
      cacheManager = new CacheManager(testFilePath);
    });

    test("加载缓存", () => {
      fs.writeFileSync(testFilePath, JSON.stringify([["key1", '"value1"'], ["key2", '"value2"']]), "utf-8");
      const manager = new CacheManager(testFilePath);
      expect(manager.get("key1")).toBe("value1");
      expect(manager.get("key2")).toBe("value2");
    });

    test("设置和获取数据", () => {
      cacheManager.set("key1", "value1");
      expect(cacheManager.get("key1")).toBe("value1");
    });

    test("移除数据", () => {
      cacheManager.set("key1", "value1");
      cacheManager.remove("key1");
      expect(cacheManager.get("key1")).toBeUndefined();
    });

    test("清除所有数据", () => {
      cacheManager.set("key1", "value1");
      cacheManager.set("key2", "value2");
      cacheManager.clear();
      expect(cacheManager.keys()).toEqual([]);
    });
  });

  describe("启用压缩", () => {
    beforeEach(() => {
      cacheManager = new CacheManager(testFilePathGzip, true);
    });

    test("加载空缓存", () => {
      expect(cacheManager.keys().length).toBe(0);
    });

    test("设置和获取数据", () => {
      cacheManager.set("key1", { value: "data1" });
      expect(cacheManager.get("key1")).toEqual({ value: "data1" });
    });

    test("保存缓存到压缩文件", () => {
      cacheManager.set("key1", { value: "data1" });
      cacheManager.commit();
      const compressedData = fs.readFileSync(testFilePathGzip);
      const decompressedData = zlib.unzipSync(compressedData);
      const entries = JSON.parse(decompressedData.toString());
      expect(entries).toEqual([["key1", '{"value":"data1"}']]);
    });

    test("加载压缩文件数据", () => {
      const serialized = JSON.stringify([["key1", '{"value":"data1"}']]);
      const compressed = zlib.gzipSync(serialized);
      fs.writeFileSync(testFilePathGzip, compressed);
      const newCacheManager = new CacheManager(testFilePathGzip, true);
      expect(newCacheManager.get("key1")).toEqual({ value: "data1" });
    });

    test("处理损坏的压缩文件", () => {
      fs.writeFileSync(testFilePathGzip, "invalid gzip data");
      const newCacheManager = new CacheManager(testFilePathGzip, true);
      expect(newCacheManager.keys().length).toBe(0);
    });
  });

  describe("序列化和反序列化", () => {
    beforeEach(() => {
      cacheManager = new CacheManager(testFilePath);
    });

    test("Map对象", () => {
      const map = new Map([["key1", "value1"], ["key2", "value2"]]);
      cacheManager.set("mapKey", map);
      const savedMap = cacheManager.get("mapKey");
      expect(savedMap).toEqual(map);
    });

    test("Set对象", () => {
      const set = new Set(["value1", "value2"]);
      cacheManager.set("setKey", set);
      const savedSet = cacheManager.get("setKey");
      expect(savedSet).toEqual(set);
    });

    test("Date对象", () => {
      const date = new Date();
      cacheManager.set("dateKey", date);
      const savedDate = cacheManager.get("dateKey");
      expect(savedDate).toEqual(date);
    });
  });

  test("自动保存", (done) => {
    cacheManager = new CacheManager(testFilePath, false);
    cacheManager.clear();
    cacheManager.setAutoSave(100); // 设置较短的间隔以便测试
    cacheManager.set("key1", { value: "data1" });
    setTimeout(() => {
      const data = fs.readFileSync(testFilePath, "utf-8");
      const entries = JSON.parse(data);
      expect(entries).toEqual([["key1", '{"value":"data1"}']]);
      done();
    }, 150);
  });

  test("加载损坏的文件", () => {
    fs.writeFileSync(testFilePath, "{invalid json");
    const newCacheManager = new CacheManager(testFilePath);
    expect(newCacheManager.keys().length).toBe(0);
  });

  test("保存和加载压缩缓存", () => {
    cacheManager = new CacheManager(testFilePath, true);
    cacheManager.set("key6", "value6");
    cacheManager.saveCache();
    const compressedData = fs.readFileSync(testFilePath);
    const decompressed = zlib.unzipSync(compressedData);
    const data = JSON.parse(decompressed.toString());
    expect(data).toEqual([["key6", '"value6"']]);
  });

  test("反序列化不同类型的值", () => {
    const map = new Map([["subKey", "subValue"]]);
    const set = new Set(["item1", "item2"]);
    const date = new Date();

    cacheManager.set("mapKey", map);
    cacheManager.set("setKey", set);
    cacheManager.set("dateKey", date);

    const serializedMap = cacheManager.serialize(map);
    const serializedSet = cacheManager.serialize(set);
    const serializedDate = cacheManager.serialize(date);

    expect(cacheManager.deserialize(serializedMap)).toEqual(map);
    expect(cacheManager.deserialize(serializedSet)).toEqual(set);
    expect(cacheManager.deserialize(serializedDate)).toEqual(date);
  });
});
