#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

/**
 * 同步npm包到npmmirror.com的脚本
 * 读取packages目录下所有npm包的包名，并通过访问同步URL手动同步版本
 */

const PACKAGES_DIR = path.join(__dirname, "..", "packages");
const BASE_URL = "http://registry-direct.npmmirror.com/-/package";

/**
 * 获取所有包的包名
 */
async function getAllPackageNames() {
    const packages = [];

    try {
        const items = fs.readdirSync(PACKAGES_DIR);

        for (const item of items) {
            const packagePath = path.join(PACKAGES_DIR, item, "package.json");

            if (fs.existsSync(packagePath)) {
                try {
                    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
                    if (packageJson.name) {
                        packages.push(packageJson.name);
                        console.log(`✓ 找到包: ${packageJson.name}`);
                    }
                } catch (error) {
                    console.error(`✗ 解析 ${packagePath} 失败:`, error.message);
                }
            }
        }
    } catch (error) {
        console.error("✗ 读取packages目录失败:", error.message);
        process.exit(1);
    }

    return packages;
}

/**
 * 同步单个包
 */
async function syncPackage(packageName) {
    const encodedPackageName = encodeURIComponent(packageName);
    const syncUrl = `${BASE_URL}/${encodedPackageName}/syncs`;

    console.log(`\n🔄 正在同步: ${packageName}`);
    console.log(`🔗 URL: ${syncUrl}`);

    try {
        // 第一步: 发送OPTIONS请求
        console.log("📡 发送 OPTIONS 请求...");
        const optionsResponse = await fetch(syncUrl, {
            method: "OPTIONS",
            headers: {
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
                Origin: "https://npmmirror.com",
            },
        });

        console.log(`OPTIONS 响应状态: ${optionsResponse.status}`);

        if (optionsResponse.status === 204) {
            console.log("✅ OPTIONS 预检通过");
        } else {
            console.warn(`⚠️ OPTIONS 预检返回状态: ${optionsResponse.status}`);
        }

        // 第二步: 发送PUT请求
        console.log("📡 发送 PUT 请求...");
        const putResponse = await fetch(syncUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                // 可以添加同步参数，如强制同步等
                // "force": true
            }),
        });

        console.log(`PUT 响应状态: ${putResponse.status}`);

        if (putResponse.ok) {
            const result = await putResponse.json();
            console.log(`✅ 同步成功: ${packageName}`);
            console.log(`📊 结果:`, result);
            return { success: true, package: packageName, result };
        } else {
            const errorText = await putResponse.text();
            console.error(`❌ 同步失败: ${packageName} - ${putResponse.status}: ${errorText}`);
            return { success: false, package: packageName, error: errorText, status: putResponse.status };
        }
    } catch (error) {
        console.error(`❌ 同步错误: ${packageName} -`, error.message);
        return { success: false, package: packageName, error: error.message };
    }
}

/**
 * 主函数
 */
async function main() {
    const isDryRun = process.argv.includes("--dry-run") || process.argv.includes("-d");

    console.log("🚀 开始同步包到 npmmirror.com...\n");

    if (isDryRun) {
        console.log("🧪 运行测试模式 (--dry-run)，不会实际发送请求");
    }

    const packageNames = await getAllPackageNames();

    if (packageNames.length === 0) {
        console.log("⚠️ 没有找到任何包");
        return;
    }

    console.log(`\n📦 共找到 ${packageNames.length} 个包需要同步`);
    console.log("=".repeat(50));

    const results = [];

    // 按顺序同步每个包，避免并发限制
    for (const packageName of packageNames) {
        if (isDryRun) {
            console.log(`\n🧪 测试模式: ${packageName}`);
            console.log(`🔗 将访问: ${BASE_URL}/${encodeURIComponent(packageName)}/syncs`);
            results.push({ success: true, package: packageName, dryRun: true });
        } else {
            const result = await syncPackage(packageName);
            results.push(result);
        }

        // 每个包之间稍作等待，避免请求过快
        if (packageNames.indexOf(packageName) < packageNames.length - 1 && !isDryRun) {
            console.log("⏳ 等待2秒后继续...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    // 总结报告
    console.log("\n" + "=".repeat(50));
    console.log("📊 同步完成总结:");
    console.log(`总包数: ${results.length}`);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`✅ 成功: ${successful.length}`);
    console.log(`❌ 失败: ${failed.length}`);

    if (failed.length > 0) {
        console.log("\n❌ 失败的包:");
        failed.forEach((result) => {
            console.log(`  - ${result.package}: ${result.error}`);
        });
    }

    if (successful.length > 0) {
        console.log("\n✅ 成功的包:");
        successful.forEach((result) => {
            if (result.dryRun) {
                console.log(`  - ${result.package} (测试模式)`);
            } else {
                console.log(`  - ${result.package}`);
            }
        });
    }

    if (isDryRun) {
        console.log("\n💡 使用 --dry-run 参数运行了测试模式");
        console.log("   要实际同步，请运行: npm run sync-npmmirror");
    }
}

// 运行脚本
if (require.main === module) {
    main().catch((error) => {
        console.error("💥 脚本执行失败:", error);
        process.exit(1);
    });
}

module.exports = { getAllPackageNames, syncPackage, main };
