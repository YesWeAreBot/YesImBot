import fs from "fs/promises";

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

export function formatDate(date: Date | number, format: string = "YYYY-MM-DD HH:mm:ss") {
    const pad = (num) => String(num).padStart(2, "0");
    if (typeof date === "number") {
        date = new Date(date);
    }
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

/**
 * 使用正则表达式估算文本的token数量（不依赖第三方库的最佳实践）
 * @param {string} text - 需要估算的文本
 * @returns {number} 估算的token数量
 */
export function estimateTokensByRegex(text: string): number {
    if (!text) {
        return 0;
    }

    // 正则表达式解释:
    // [\u4e00-\u9fa5]      - 匹配单个中文字符
    // | [a-zA-Z]+          - 匹配一个或多个连续的英文字母（一个单词）
    // | \d+                - 匹配一个或多个连续的数字
    // | [^\s\da-zA-Z\u4e00-\u9fa5] - 匹配任何非空白、非数字、非英文、非中文的单个字符（主要是标点符号）
    const regex = /[\u4e00-\u9fa5]|[a-zA-Z]+|\d+|[^\s\da-zA-Z\u4e00-\u9fa5]/g;

    const matches = text.match(regex);

    return matches ? matches.length : 0;
}
