import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { arrayBufferToBase64, Context, Element } from "koishi";
import path from "path";
import { IMAGE_TABLE, ImageData } from "../types/model";

export class ImageProcessor {
    private cachePath: string;

    constructor(private ctx: Context) {
        this.cachePath = path.join(ctx.baseDir, "data", "yesimbot", "image_cache");
        try {
            if (!existsSync(this.cachePath)) {
                mkdirSync(this.cachePath, { recursive: true });
            }
        } catch (error) {
            this.ctx.logger.error("Error creating cache directory:", error);
        }
    }

    async getBase64(image_id: string): Promise<string> {
        let [imageData] = (await this.ctx.database?.get(IMAGE_TABLE, { id: image_id })) || [];
        if (!imageData) return;
        const image = await readFile(path.join(this.cachePath, image_id), "base64");
        const mimeType = imageData["mimeType"];
        const base64 = `data:${mimeType};base64,${image}`;

        return base64;
    }

    /**
     * 处理图片
     * @param image_url 图片url
     * @returns 处理后的图片数据
     *
     * 处理流程：
     * 1. 下载图片，获取hash值，判断是否已经存在
     * 2. 如果不存在，获取描述等信息，保存到数据库
     * 3. 如果存在，直接返回
     * 4. 如果失败，返回null
     */
    async process(image_url: string | Element): Promise<ImageData> {
        let { src, summary } = typeof image_url === "string" ? { src: image_url } : image_url.attrs;

        const image = await this.download(src);
        if (!image) return null;

        const hash = this.hash(image);
        let [imageData] = (await this.ctx.database?.get(IMAGE_TABLE, { id: hash })) || [];
        if (imageData) return imageData;

        // 保存文件
        await writeFile(path.join(this.cachePath, hash), Buffer.from(image));
        // 获取描述等信息，保存到数据库
        const mimeType = this.getMimeType(image);
        const base64 = `data:${mimeType};base64,${arrayBufferToBase64(image)}`;
        const desc = ""; // TODO: 调用模型获取描述
        const size = image.byteLength;

        imageData = {
            id: hash,
            mimeType,
            // base64,
            summary: summary || "",
            desc,
            size,
            timestamp: new Date(),
        };
        await this.ctx.database?.create(IMAGE_TABLE, imageData);
        return imageData;
    }

    private async download(image_url: string): Promise<ArrayBuffer> {
        try {
            if (this.ctx.http) {
                return await this.ctx.http.get(image_url, { responseType: "arraybuffer" });
            } else {
                const res = await fetch(image_url);
                return await res.arrayBuffer();
            }
        } catch (error) {
            this.ctx.logger.error("Error downloading image");
            this.ctx.logger.error(error);
        }
    }

    private hash(image: ArrayBuffer): string {
        const hash = createHash("md5");
        hash.update(Buffer.from(image));
        return hash.digest("hex");
    }

    private getMimeType(image: ArrayBuffer): string {
        const buffer = Buffer.from(image);
        const magicNumbers = buffer.subarray(0, 4);
        const magicNumber = magicNumbers.readUInt32BE(0);
        switch (magicNumber) {
            case 0x89504e47:
                return "image/png"; // PNG
            case 0x47494638:
                return "image/gif"; // GIF
            case 0xffd8ffdb:
            case 0xffd8ffe0:
            case 0xffd8ffe1:
            case 0xffd8ffe2:
                return "image/jpeg"; // JPEG
            case 0x424d:
                return "image/bmp"; // BMP
            case 0x4d4d:
                return "image/tiff"; // TIFF
            case 0x52494646:
            case 0x57454250:
                return "image/webp"; // WEBP
            default:
                return "image/unknown";
        }
    }
}
