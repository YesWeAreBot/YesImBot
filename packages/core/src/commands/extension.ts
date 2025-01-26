import { Context } from "koishi";
import path from 'path';
import fs from 'fs/promises';
import { downloadFile, readMetadata } from "../utils";

// 文件名标准化函数
function normalizeFilename(original: string): string {
    // 移除已有扩展名前缀（如果有的话）
    const baseName = original.startsWith('ext_')
        ? original.slice(4)
        : original;

    // 添加统一前缀
    return `ext_${baseName}`;
}

export function apply(ctx: Context) {
    ctx
        .command("安装扩展 <url>", { authority: 3 })
        .usage("安装 Athena 扩展文件")
        .example(
            [
                "安装扩展 https://example.com/plugin.js",
                "安装扩展 https://example.com/plugin.js -f custom"
            ].join("\n")
        )
        .option("file", "-f <filename>  指定保存的文件名", { type: "string" })
        .action(async ({ session, options }, url) => {
            try {
                ctx.logger.info(`[扩展安装] 开始从 ${url} 安装扩展...`);

                // 环境模式检测
                const isDevMode = process.env.NODE_ENV === 'development';
                ctx.logger.info(`[环境模式] ${isDevMode ? '开发环境 🛠️' : '生产环境 🚀'}`);

                // 动态生成存储路径
                const extensionPath = path.join(
                    ctx.baseDir,
                    isDevMode
                        ? 'external/yesimbot/packages/core/lib/extensions'
                        : 'node_modules/koishi-plugins-yesimbot/lib/extensions'
                );
                ctx.logger.info(`[路径配置] 扩展存储目录：${extensionPath}`);
                await fs.mkdir(extensionPath, { recursive: true });

                // 文件名处理流程
                let filename: string;
                if (options.file) {
                    // 处理用户指定文件名
                    filename = options.file.endsWith('.js')
                        ? options.file
                        : `${options.file}.js`;
                } else {
                    // 从 URL 提取文件名
                    filename = path.basename(url);
                    if (!filename.endsWith('.js')) {
                        throw new Error('URL 必须指向 .js 文件');
                    }
                }

                // 强制添加前缀（不影响已有 ext_ 开头的情况）
                filename = normalizeFilename(filename);

                // 安全校验（二次防御）
                if (!/^ext_[\w\-]+\.js$/.test(filename)) {
                    throw new Error('文件名格式无效，应为 ext_开头 + 字母数字 + .js');
                }

                const filePath = path.join(extensionPath, filename);

                // 交互式覆盖确认
                try {
                    await fs.access(filePath);
                    await session?.send(`文件 ${ filename } 已存在，是否覆盖？(y / N)`);
                    const confirm = await session?.prompt();
                    if (!confirm?.toLowerCase().startsWith('y')) {
                        return '❌ 用户取消操作';
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
                    throw new Error('无法读取扩展元数据');
                }

                // 校验元数据中的名称一致性
                if (metadata.name && !metadata.name.startsWith('ext_')) {
                    ctx.logger.warn('[元数据警告] 扩展名称建议以 ext_ 开头');
                }

                // 格式化日志输出
                ctx.logger.info(`[扩展信息] 安装详情：
  - 文件名称：${filename}
  - 显示名称：${metadata.name || '未命名扩展'}
  - 版本号：${metadata.version || '0.0.0'}
  - 作者：${metadata.author || '匿名'}`);

                return `✅ 扩展 ${metadata.name || filename} 安装完成，请重启 Koishi 以生效。`;

            } catch (error) {
                ctx.logger.error('[扩展安装] 失败原因：', error);
                return `❌ 安装失败：${error.message}`;
            }
        });
}