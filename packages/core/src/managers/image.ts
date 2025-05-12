import { createHash } from "crypto";
import fs from "fs";
import path from "path";


interface Metadata {
    url: string;
    size: number;
    hash: string;
    contentType: string;
    createdAt: number;
    fileUnique?: string;
}

export class ImageCache {
    static instance: ImageCache | null = null;
    private metadata: { [key: string]: Metadata };
    private metadataFile: string;

    constructor(private savePath: string) {
        // 确保目录存在
        if (!fs.existsSync(this.savePath)) {
            fs.mkdirSync(this.savePath, { recursive: true });
        }

        this.metadataFile = path.join(this.savePath, "metadata.json");

        // 确保 metadata.json 文件存在
        if (!fs.existsSync(this.metadataFile)) {
            fs.writeFileSync(this.metadataFile, "{}", "utf-8");
        }

        try {
            const metadataContent = fs.readFileSync(this.metadataFile, "utf-8");
            this.metadata = JSON.parse(metadataContent);
        } catch (error) {
            console.error("Error reading metadata file:", error);
            this.metadata = {};
            // 如果读取失败，创建一个新的空metadata文件
            fs.writeFileSync(this.metadataFile, "{}", "utf-8");
        }

        console.debug("ImageCache initialized.")
    }

    get(key: string): Buffer {
        const metadata = this.metadata[key];
        if (metadata) {
            try {
                return fs.readFileSync(path.join(this.savePath, metadata.hash));
            } catch (error) {
                console.error(`Error reading file for key ${key}:`, error);
                throw new Error(`Image not found: ${key}`);
            }
        }
        throw new Error(`Image not found: ${key}`);
    }

    set(url: string, buffer: Buffer, contentType: string, hash?: string, fileUnique?: string): void {
        if (!hash) {
            hash = createHash('md5').update(buffer).digest('hex');
        }
        if (!fileUnique) {
            fileUnique = hash;
        }
        this.metadata[fileUnique] = {
            url: url,
            size: buffer.length,
            hash,
            contentType,
            createdAt: Date.now(),
            fileUnique,
        };
        const filePath = path.join(this.savePath, hash);
        try {
            fs.writeFileSync(filePath, buffer);
            fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
        } catch (error) {
            console.error("Error writing files:", error);
            delete this.metadata[fileUnique];
            fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
            throw error;
        }
    }

    has(key: string): boolean {
        return key in this.metadata;
    }

    delete(key: string): void {
        if (key in this.metadata) {
            const hash = this.metadata[key].hash;
            const filePath = path.join(this.savePath, hash);
            try {
                fs.unlinkSync(filePath);
                delete this.metadata[key];
                fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
            } catch (error) {
                console.error(`Error deleting file for key ${key}:`, error);
                throw error;
            }
        }
    }

    clear(): void {
        try {
            fs.readdirSync(this.savePath).forEach(file => {
                fs.unlinkSync(path.join(this.savePath, file));
            });
            this.metadata = {};
            fs.writeFileSync(this.metadataFile, "{}", "utf-8");
        } catch (error) {
            console.error("Error clearing cache:", error);
            throw error;
        }
    }

    keys(): string[] {
        return Object.keys(this.metadata);
    }

    /**
     * 清理过期缓存
     * @param maxAge 最大缓存时间(毫秒)，默认7天
     */
    cleanExpired(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
        const now = Date.now();
        let count = 0;

        for (const key in this.metadata) {
            const item = this.metadata[key];
            if (now - item.createdAt > maxAge) {
                try {
                    fs.unlinkSync(path.join(this.savePath, item.hash));
                    delete this.metadata[key];
                    count++;
                } catch (error) {
                    console.error(`Error deleting expired cache ${key}:`, error);
                }
            }
        }

        if (count > 0) {
            fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
        }
        return count;
    }

    getMetadata(key: string): Metadata | undefined {
        return this.metadata[key];
    }
}

