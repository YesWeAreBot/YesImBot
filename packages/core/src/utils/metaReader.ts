import fs from 'fs';
import path from 'path';

/**
 * 从指定的 TypeScript 文件中读取元数据。
 * 
 * 该函数读取文件内容，查找以 `// ==Extension==` 开始和 `// ==/Extension==` 结束的部分，并提取其中以 `// @` 开头的元数据信息。
 * 元数据信息存储在一个对象中，键是 `@` 后面的标识符（去除 `@`），值是标识符后面的描述信息。
 * 
 * @param filePath - 要读取元数据的 TypeScript 文件的路径。
 * @returns 一个包含元数据的对象，键是元数据标识符（如 `name`、`version` 等），值是对应信息。若格式错误或读取失败返回空对象。
 */
export function readMetadata(filePath: string): { [key: string]: string } {
    try {
        const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
        const metadata: { [key: string]: string } = {};
        const lines = content.split('\n');
        let capturing = false;

        for (const line of lines) {
            const trimmedLine = line.trim();

            if (trimmedLine === '// ==Extension==') {
                capturing = true;
                continue;
            }
            if (trimmedLine === '// ==/Extension==') {
                capturing = false;
                continue;
            }

            if (capturing && trimmedLine.startsWith('// @')) {
                // 移除注释符号和空格，分割键值
                const metaLine = trimmedLine.substring(3).trim(); // 去掉 '// ' 得到 '@key value'
                const firstSpaceIndex = metaLine.indexOf(' ');

                if (firstSpaceIndex === -1) {
                    // 只有键没有值的情况（如 '// @key'）
                    const key = metaLine.substring(1); // 去掉 '@'
                    metadata[key] = '';
                } else {
                    // 分割键和值
                    const key = metaLine.substring(1, firstSpaceIndex); // 取 '@' 后到第一个空格前的部分
                    const value = metaLine.substring(firstSpaceIndex + 1).trim();
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