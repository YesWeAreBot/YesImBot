import { Context } from "koishi";
import { AssetService } from "./service";
import { AssetServiceConfig } from "./config";
import { LocalStorageDriver } from "./drivers";

/**
 * 资源中心服务测试
 * 这是一个简单的测试示例，展示如何使用资源中心的各种功能
 */
async function testAssetService() {
    console.log("=== 资源中心服务测试 ===");

    // 创建测试上下文（实际使用中由Koishi提供）
    const ctx = new Context();
    
    // 模拟配置
    const config: AssetServiceConfig = {
        storagePath: "test-assets",
        driver: "local",
        autoClearEnabled: false, // 测试时禁用自动清理
        autoClearIntervalHours: 24,
        maxAssetAgeDays: 30,
        maxFileSize: 10 * 1024 * 1024, // 10MB
        supportedMimeTypes: [
            "image/jpeg", "image/png", "text/plain", "application/json"
        ]
    };

    try {
        // 初始化服务（注意：实际使用中不需要手动初始化）
        const assetService = new AssetService(ctx, config);
        
        console.log("✓ 服务初始化成功");

        // 测试1: 从Buffer创建资源
        console.log("\n--- 测试1: 从Buffer创建资源 ---");
        const testContent = "Hello, World! This is a test file.";
        const buffer = Buffer.from(testContent, 'utf-8');
        
        const id1 = await assetService.create(buffer, { 
            filename: "test.txt" 
        });
        console.log(`✓ 资源已创建，ID: ${id1}`);

        // 测试2: 获取资源内容
        console.log("\n--- 测试2: 获取资源内容 ---");
        const retrievedBuffer = await assetService.get(id1);
        const retrievedContent = retrievedBuffer.toString('utf-8');
        
        if (retrievedContent === testContent) {
            console.log("✓ 资源内容验证成功");
        } else {
            console.log("✗ 资源内容验证失败");
        }

        // 测试3: 获取资源信息
        console.log("\n--- 测试3: 获取资源信息 ---");
        const info = await assetService.getInfo(id1);
        console.log(`✓ 资源信息:`, {
            id: info.id,
            type: info.type,
            mime: info.mime,
            size: info.size,
            filename: info.filename
        });

        // 测试4: 获取资源URL
        console.log("\n--- 测试4: 获取资源URL ---");
        const url = await assetService.getURL(id1);
        console.log(`✓ 资源URL: ${url.substring(0, 100)}...`);

        // 测试5: 重复创建相同内容（测试去重）
        console.log("\n--- 测试5: 测试去重功能 ---");
        const id2 = await assetService.create(buffer, { 
            filename: "test-duplicate.txt" 
        });
        
        if (id1 === id2) {
            console.log("✓ 去重功能正常，返回相同ID");
        } else {
            console.log("✗ 去重功能异常，返回不同ID");
        }

        // 测试6: 测试不支持的文件类型
        console.log("\n--- 测试6: 测试不支持的文件类型 ---");
        try {
            await assetService.create(Buffer.from("test"), { 
                filename: "test.exe" 
            });
            console.log("✗ 应该拒绝不支持的文件类型");
        } catch (error) {
            console.log("✓ 正确拒绝了不支持的文件类型");
        }

        // 测试7: 测试文件大小限制
        console.log("\n--- 测试7: 测试文件大小限制 ---");
        const largeBuffer = Buffer.alloc(config.maxFileSize + 1);
        try {
            await assetService.create(largeBuffer, { 
                filename: "large.txt" 
            });
            console.log("✗ 应该拒绝超大文件");
        } catch (error) {
            console.log("✓ 正确拒绝了超大文件");
        }

        console.log("\n=== 所有测试完成 ===");

    } catch (error) {
        console.error("测试失败:", error.message);
        console.error(error.stack);
    }
}

/**
 * 存储驱动测试
 */
async function testStorageDriver() {
    console.log("\n=== 存储驱动测试 ===");

    const ctx = new Context();
    const driver = new LocalStorageDriver(ctx, { path: "test-storage" });

    try {
        const testId = "test-file-123";
        const testData = Buffer.from("Test storage driver content");

        // 写入测试
        await driver.write(testId, testData);
        console.log("✓ 文件写入成功");

        // 读取测试
        const readData = await driver.read(testId);
        if (readData.equals(testData)) {
            console.log("✓ 文件读取验证成功");
        } else {
            console.log("✗ 文件读取验证失败");
        }

        // 删除测试
        await driver.delete(testId);
        console.log("✓ 文件删除成功");

        // 验证删除
        try {
            await driver.read(testId);
            console.log("✗ 文件应该已被删除");
        } catch (error) {
            console.log("✓ 确认文件已被删除");
        }

    } catch (error) {
        console.error("存储驱动测试失败:", error.message);
    }
}

/**
 * 运行所有测试
 */
async function runTests() {
    await testStorageDriver();
    await testAssetService();
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
    runTests().catch(console.error);
}

export { testAssetService, testStorageDriver, runTests };
