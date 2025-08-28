/**
 * optimize-canary-version.js
 *
 * 功能：优化Canary预发布版本的版本号格式
 * 工作流程：
 * 1. 扫描 `packages/` 目录下每个包
 * 2. 读取 `CHANGELOG.md` 文件和 `package.json` 文件
 * 3. 识别预发布版本（包含 `-canary` 的版本）
 * 4. 将40位的 commit id 缩短至 7 位，优化可读性
 * 5. 更新 `CHANGELOG.md` 和 `package.json` 中的版本号
 *
 * 使用场景：在发布Canary版本前运行，优化版本号格式
 *
 * @example
 * 输入：1.0.1-canary.f812fe748c45734fc4145f4d7c773df313d9885a
 * 输出：1.0.1-canary.f812fe7
 */

const fs = require("fs");
const path = require("path");

const PACKAGES_DIR = path.join(__dirname, "../packages");

/**
 * 缩短预发布版本中的commit id至7位
 * @param {string} version - 版本号
 * @returns {string} - 缩短后的版本号
 */
function shortenCanaryVersion(version) {
    if (!version.includes("-canary.")) {
        return version;
    }

    const parts = version.split("-canary.");
    const baseVersion = parts[0];
    const commitId = parts[1];

    if (commitId && commitId.length > 7) {
        const shortCommitId = commitId.substring(0, 7);
        return `${baseVersion}-canary.${shortCommitId}`;
    }

    return version;
}

/**
 * 更新package.json中的版本号（包括主版本和所有依赖）
 * @param {string} packagePath - 包路径
 */
function updatePackageJson(packagePath) {
    const packageJsonPath = path.join(packagePath, "package.json");

    if (!fs.existsSync(packageJsonPath)) {
        console.warn(`⚠️  ${packageJsonPath} 不存在，跳过`);
        return;
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        let hasChanges = false;
        const changes = [];

        // 更新主版本号
        const originalVersion = packageJson.version;
        const newVersion = shortenCanaryVersion(originalVersion);
        if (originalVersion !== newVersion) {
            packageJson.version = newVersion;
            hasChanges = true;
            changes.push(`主版本: ${originalVersion} → ${newVersion}`);
        }

        // 更新dependencies中的版本号
        if (packageJson.dependencies) {
            for (const [depName, version] of Object.entries(packageJson.dependencies)) {
                if (typeof version === "string" && version.includes("-canary.")) {
                    const newDepVersion = shortenCanaryVersion(version);
                    if (version !== newDepVersion) {
                        packageJson.dependencies[depName] = newDepVersion;
                        hasChanges = true;
                        changes.push(`依赖 ${depName}: ${version} → ${newDepVersion}`);
                    }
                }
            }
        }

        // 更新devDependencies中的版本号
        if (packageJson.devDependencies) {
            for (const [depName, version] of Object.entries(packageJson.devDependencies)) {
                if (typeof version === "string" && version.includes("-canary.")) {
                    const newDepVersion = shortenCanaryVersion(version);
                    if (version !== newDepVersion) {
                        packageJson.devDependencies[depName] = newDepVersion;
                        hasChanges = true;
                        changes.push(`开发依赖 ${depName}: ${version} → ${newDepVersion}`);
                    }
                }
            }
        }

        // 更新peerDependencies中的版本号
        if (packageJson.peerDependencies) {
            for (const [depName, version] of Object.entries(packageJson.peerDependencies)) {
                if (typeof version === "string" && version.includes("-canary.")) {
                    const newDepVersion = shortenCanaryVersion(version);
                    if (version !== newDepVersion) {
                        packageJson.peerDependencies[depName] = newDepVersion;
                        hasChanges = true;
                        changes.push(`对等依赖 ${depName}: ${version} → ${newDepVersion}`);
                    }
                }
            }
        }

        if (hasChanges) {
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
            console.log(`✅ 已更新 ${path.basename(packagePath)}/package.json:`);
            changes.forEach((change) => console.log(`   - ${change}`));
        } else {
            console.log(`ℹ️  ${path.basename(packagePath)}/package.json 无需更新`);
        }
    } catch (error) {
        console.error(`❌ 更新 ${packageJsonPath} 失败:`, error.message);
    }
}

/**
 * 更新CHANGELOG.md中的版本号
 * @param {string} packagePath - 包路径
 */
function updateChangelog(packagePath) {
    const changelogPath = path.join(packagePath, "CHANGELOG.md");

    if (!fs.existsSync(changelogPath)) {
        console.warn(`⚠️  ${changelogPath} 不存在，跳过`);
        return;
    }

    try {
        let changelog = fs.readFileSync(changelogPath, "utf8");
        const originalChangelog = changelog;

        // 匹配预发布版本号的正则表达式
        const canaryVersionRegex = /(\d+\.\d+\.\d+-canary\.)([a-f0-9]{40})/g;

        changelog = changelog.replace(canaryVersionRegex, (match, prefix, commitId) => {
            return prefix + commitId.substring(0, 7);
        });

        if (originalChangelog !== changelog) {
            fs.writeFileSync(changelogPath, changelog);
            console.log(`✅ 已更新 ${path.basename(packagePath)}/CHANGELOG.md`);
        } else {
            console.log(`ℹ️  ${path.basename(packagePath)}/CHANGELOG.md 无需更新`);
        }
    } catch (error) {
        console.error(`❌ 更新 ${changelogPath} 失败:`, error.message);
    }
}

/**
 * 主函数：处理所有包
 */
function processPackages() {
    console.log("🚀 开始处理预发布版本号的commit id缩短...\n");

    if (!fs.existsSync(PACKAGES_DIR)) {
        console.error(`❌ packages目录不存在: ${PACKAGES_DIR}`);
        process.exit(1);
    }

    const packages = fs.readdirSync(PACKAGES_DIR).filter((dir) => {
        const packagePath = path.join(PACKAGES_DIR, dir);
        return fs.statSync(packagePath).isDirectory();
    });

    if (packages.length === 0) {
        console.log("ℹ️ 未找到任何包");
        return;
    }

    console.log(`📦 找到 ${packages.length} 个包:\n`);

    packages.forEach((packageName) => {
        const packagePath = path.join(PACKAGES_DIR, packageName);
        console.log(`正在处理: ${packageName}`);

        updatePackageJson(packagePath);
        updateChangelog(packagePath);

        console.log(""); // 空行分隔
    });

    console.log("✨ 处理完成！");
}

// 执行主函数
if (require.main === module) {
    processPackages();
}

module.exports = {
    shortenCanaryVersion,
    updatePackageJson,
    updateChangelog,
    processPackages,
};
