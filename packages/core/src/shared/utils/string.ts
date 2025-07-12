export function isEmpty(str: string) {
    return !str || String(str) == "";
}

export function isNotEmpty(str: string) {
    return !isEmpty(str);
}

export function formatSize(size: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }
    return `${size.toFixed(2)}${units[index]}`;
}

export function randomString(length: number): string {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// 辅助函数：截断长字符串以便于日志显示
export const truncate = (str: string, length = 80) => {
    if (str.length <= length) return str;
    return `${str.slice(0, length)}...`;
};

export function stringify(obj: any): string {
    return typeof obj === "string" ? obj || "" : JSON.stringify(obj);
}

export function trimStart(text: string) {
    return text.replace(/^\s+/gm, "");
}

export function trimEnd(text: string) {
    return text.replace(/\s+$/gm, "");
}

export function trim(text: string) {
    return trimStart(trimEnd(text));
}
