import fs from 'fs';
import path from 'path';

/**
 * 从指定的 TypeScript 文件中读取元数据。
 * 
 * 该函数读取文件内容，查找以 `// ==Extension==` 开始和 `// ==/Extension==` 结束的部分，并提取其中以 `// @` 开头的元数据信息。
 * 元数据信息存储在一个对象中，键是 `@` 后面的标识符，值是标识符后面的描述信息。
 * 
 * @param filePath - 要读取元数据的 TypeScript 文件的路径。
 * @returns 一个包含元数据的对象，键是元数据标识符（如 `name`、`version`、`description` 等），值是相应的元数据信息。如果不是预期格式则返回空对象。
 * 
 */
export function readMetadata(filePath: string): { [key: string]: string } {
    try {
        const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
        const metadata: { [key: string]: string } = {};
        const lines = content.split('\n');
        let capturing = false;
        for (const line of lines) {
            if (line.trim() === '// ==Extension==') {
                capturing = true;
                continue;
            }
            if (line.trim() === '// ==/Extension==') {
                capturing = false;
                continue;
            }
            if (capturing) {
                if (line.trim().startsWith('// @')) {
                    const parts = line.trim().substring(3).split(' ');
                    const key = parts[0];
                    const value = parts.slice(1).join(' ');
                    metadata[key] = value;
                }
            }
        }
        return metadata;
    } catch (error) {
        console.error(`Error reading file: ${error}`);
        return {};
    }
}