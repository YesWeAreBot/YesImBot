import { mkdirSync, readdirSync } from "fs";
import fs from "fs/promises";
import { Context } from "koishi";
import path from "path";

import { isEmpty } from "./string";

/**
 * 消息内容是否包含过滤词
 * @param content
 * @param FilterList
 * @returns
 */
export function containsFilter(content: string, FilterList: string[]): boolean {
    for (const filter of FilterList) {
        if (isEmpty(filter)) continue;
        let regex = new RegExp(filter, "gi");
        if (regex.test(content)) return true;
    }
    return false;
}

export function formatDate(date: Date, format: string = "YYYY-MM-DD HH:mm:ss") {
    const pad = (num) => String(num).padStart(2, "0");
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    return format
        .replace(/YYYY/g, year.toString())
        .replace(/YY/g, String(year).slice(-2))
        .replace(/MM/g, pad(month))
        .replace(/M/g, month.toString())
        .replace(/DD/g, pad(day))
        .replace(/D/g, day.toString())
        .replace(/HH/g, pad(hours))
        .replace(/H/g, hours.toString())
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, minutes.toString())
        .replace(/ss/g, pad(seconds))
        .replace(/s/g, seconds.toString());
}

/**
 * 获取频道类型
 */
export function getChannelType(channelId: string): "private" | "guild" | "sandbox" {
    if (channelId.startsWith("private:")) {
        return "private";
    } else if (channelId === "#") {
        return "sandbox";
    } else {
        return "guild";
    }
}

/**
 * 下载文件
 * @param url 文件URL
 * @param path 文件路径
 * @param overwrite 是否覆盖
 * @returns
 */
export async function downloadFile(url: string, path: string, overwrite: boolean = false) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (!overwrite) {
        try {
            await fs.access(path);
            throw new Error("文件已存在");
        } catch {
            // 文件不存在时忽略错误
        }
    } else {
        await fs.unlink(path).catch(() => {});
        fs.writeFile(path, Buffer.from(await response.arrayBuffer()));
    }
}

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

export function toBoolean(value: any): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const lowerValue = value.toLowerCase().trim();
        if (lowerValue === "true") return true;
        if (lowerValue === "false") return false;
    }
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    // 对于其他情况，使用 JavaScript 的隐式转换规则
    return Boolean(value);
}
