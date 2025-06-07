import { mkdirSync, readdirSync } from "fs";
import { Context } from "koishi";
import path from "path";

/**
 * 获取扩展目录路径
 */
export function getExtensionPath(ctx: Context, builtin: boolean = false): string {
    let extensionPath;
    if (builtin) {
        extensionPath = path.join(__dirname, "../", "extensions", "builtin");
    } else {
        extensionPath = path.join(ctx.baseDir, "data", "yesimbot", "extensions");
    }

    try {
        mkdirSync(extensionPath, { recursive: true });
    } catch (err) {}

    return extensionPath;
}

/**
 * 文件名标准化函数
 * @param original
 * @returns
 */
export function normalizeFilename(original: string): string {
    // 移除已有扩展名前缀（如果有的话）
    const baseName = original.startsWith("ext_") ? original.slice(4) : original;

    // 添加统一前缀
    return `ext_${baseName}`;
}

/**
 * 获取有效扩展文件列表
 * @param ctx
 * @returns
 */
export function getExtensionFiles(ctx: Context): string[] {
    const builtin = getExtensionPath(ctx, true);
    const user = getExtensionPath(ctx);
    try {
        const builtinFiles = readdirSync(builtin, { recursive: true }).map((file) => path.join(builtin, file)) || [];
        const userFiles = readdirSync(user, { recursive: true }).map((file) => path.join(builtin, file)) || [];
        const files = Array.from(new Set([...builtinFiles, ...userFiles]));
        return files.filter((file) => {
            file = path.basename(file);
            return file.startsWith("ext_") && (file.endsWith(".js") || file.endsWith(".ts")) && !file.endsWith(".d.ts");
        });
    } catch (error) {
        ctx.logger.error("读取扩展目录失败:");
        ctx.logger.error(error);
        return [];
    }
}
