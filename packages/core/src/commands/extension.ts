import fs from "fs/promises";
import { Context } from "koishi";
import path from "path";

import { downloadFile, getExtensionFiles, getExtensionPath, isEmpty, normalizeFilename, readMetadata } from "../utils";

// 扩展信息类型
interface ExtensionInfo {
    fileName: string;
    name: string;
    version: string;
    author: string;
    description?: string;
}

export const name = "yesimbot.command.extension";

export function apply(ctx: Context) {
    // 扩展列表指令
    ctx.command("扩展列表", "显示已安装的扩展列表", { authority: 3 }).action(async ({ session }) => {
        try {
            const extFiles = await getExtensionFiles(ctx);
            if (extFiles.length === 0) {
                return "当前没有安装任何扩展。";
            }

            const extensions: ExtensionInfo[] = [];
            for (const file of extFiles) {
                try {
                    const metadata = readMetadata(file);
                    if (!metadata) continue;

                    extensions.push({
                        fileName: path.basename(file),
                        name: metadata.name || "未命名扩展",
                        version: metadata.version || "0.0.0",
                        author: metadata.author || "未知作者",
                        description: metadata.description,
                    });
                } catch (error) {
                    ctx.logger.warn(`[${file}] 元数据读取失败:`, error);
                }
            }

            if (extensions.length === 0) {
                return "没有找到有效的扩展。";
            }

            // 格式化输出
            let message = "📦 已安装扩展列表：\n\n";
            message += extensions
                .map(
                    (ext, index) =>
                        `【${index + 1}】${ext.name}
  - 文件：${ext.fileName}
  - 版本：v${ext.version}
  - 作者：${ext.author}
  ${ext.description ? `- 描述：${ext.description}` : "- 请联系扩展作者添加详细信息。"}`
                )
                .join("\n\n");

            return message;
        } catch (error) {
            ctx.logger.error("扩展列表获取失败:", error);
            return "❌ 获取扩展列表失败，请查看日志。";
        }
    });

    // 删除扩展指令
    ctx.command("删除扩展 <fileName>", "删除指定扩展文件", { authority: 3 })
        .option("force", "-f  强制删除（跳过确认）")
        .usage(
            [
                "注意：",
                "1. 文件名不需要输入 ext_ 前缀和 .js 后缀",
                "2. 实际删除时会自动补全前缀和后缀",
                "示例：删除扩展 example → 实际删除 ext_example.js",
            ].join("\n")
        )
        .example("删除扩展 example -f")
        .action(async ({ session, options }, fileName) => {
            try {
                if (!fileName) return "请输入要删除的扩展名称。";

                // 文件名标准化处理
                let processedName = fileName.trim();
                // 补充扩展名
                if (!processedName.endsWith(".js")) processedName += ".js";
                // 强制前缀处理
                processedName = normalizeFilename(processedName);

                const filePath = path.join(getExtensionPath(ctx), processedName);

                try {
                    await fs.access(filePath);
                } catch {
                    return `❌ 扩展文件 ${processedName} 不存在。`;
                }

                if (!options.force) {
                    await session.send(`⚠️ 确认要删除扩展 ${processedName} 吗？(y/N)`);
                    const confirm = await session.prompt(5000);
                    if (!confirm || !confirm.toLowerCase().startsWith("y")) {
                        return "🗑️ 删除操作已取消。";
                    }
                }

                await fs.unlink(filePath);
                ctx.logger.success(`扩展删除成功: ${processedName}`);

                return `✅ 扩展 ${processedName} 已删除。\n` + '请使用 "重载插件" 命令使更改生效。';
            } catch (error) {
                ctx.logger.error("扩展删除失败:", error);
                return `❌ 删除失败：${error.message}`;
            }
        });

    ctx.command("重载插件", { authority: 3 })
        .usage("重载 Athena，用于生效扩展变更。")
        .action(({ session }) => {
            session.send("✅ 已进行重载操作。");
            ctx.scope.restart();
        });

    ctx.command("安装扩展 <url>", { authority: 3 })
        .usage("安装 Athena 扩展文件")
        .example(["安装扩展 https://example.com/plugin.js", "安装扩展 https://example.com/plugin.js -f custom"].join("\n"))
        .option("file", "-f <filename>  指定保存的文件名", { type: "string" })
        .action(async ({ session, options }, url) => {
            try {
                if (isEmpty(url) || isEmpty(options.file)) return "❌ 请提供下载链接";

                ctx.logger.info(`[扩展安装] 开始从 ${url} 安装扩展...`);

                const isDevMode = process.env.NODE_ENV === "development";
                ctx.logger.info(`[环境模式] ${isDevMode ? "开发环境 🛠️" : "生产环境 🚀"}`);

                const extensionPath = getExtensionPath(ctx);
                ctx.logger.info(`[路径配置] 扩展存储目录：${extensionPath}`);
                await fs.mkdir(extensionPath, { recursive: true });

                // 文件名处理流程
                let filename: string;
                if (options.file) {
                    // 处理用户指定文件名
                    filename = options.file.endsWith(".js") ? options.file : `${options.file}.js`;
                } else {
                    // 从 URL 提取文件名
                    filename = path.basename(url);
                    if (!filename.endsWith(".js")) {
                        throw new Error("URL 必须指向 .js 文件");
                    }
                }

                // 强制添加前缀（不影响已有 ext_ 开头的情况）
                filename = normalizeFilename(filename);

                // 安全校验（二次防御）
                if (!/^ext_[\w\-]+\.js$/.test(filename)) {
                    throw new Error("文件名格式无效，应为 ext_开头 + 字母数字 + .js");
                }

                const filePath = path.join(extensionPath, filename);

                // 交互式覆盖确认
                try {
                    await fs.access(filePath);
                    ctx.logger.warn("[文件下载] 文件已存在，等待用户操作");
                    await session?.send(`文件 ${filename} 已存在，是否覆盖？(y / N)`);
                    const confirm = await session?.prompt();
                    if (!confirm?.toLowerCase().startsWith("y")) {
                        return "❌ 用户取消操作";
                    }
                } catch {
                    // 文件不存在时忽略错误
                }

                // 下载文件
                await downloadFile(url, filePath, true);
                ctx.logger.success(`[文件下载] 扩展文件已保存至：${filePath}`);

                // 读取元数据
                const metadata = readMetadata(filePath);
                if (!metadata) {
                    throw new Error("无法读取扩展元数据");
                }

                ctx.logger.info(`[扩展信息] 安装详情：
  - 文件名称：${filename}
  - 显示名称：${metadata.name || "未命名扩展"}
  - 版本号：${metadata.version || "0.0.0"}
  - 作者：${metadata.author || "匿名"}`);

                return `✅ 扩展 ${metadata.name || filename} 安装完成。输入 "重载插件" 以生效。
详情：
- 文件名称：${filename}
- 显示名称：${metadata.name || "未命名扩展"}
- 版本号：${metadata.version || "0.0.0"}
- 作者：${metadata.author || "匿名"}`;
            } catch (error) {
                ctx.logger.error("[扩展安装] 失败原因：", error);
                return `❌ 安装失败：${error.message}`;
            }
        });
}
