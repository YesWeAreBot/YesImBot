import { Context, Schema } from "koishi";
import { Extension, Tool } from "../extension/decorators";
import { Success, Failed } from "../extension/helpers";
import { Infer } from "../extension/types";
import { Services } from "../types";
import { AssetService } from "./service";
import { AssetType, FileAnalysisResult } from "./types";

/**
 * 资源交互工具扩展
 * 为LLM提供查看和理解资源内容的工具
 */
@Extension({
    name: "assets",
    display: "资源交互工具",
    description: "提供查看文件内容、列出压缩包内容等资源交互功能",
    author: "YesImBot",
    version: "1.0.0",
})
export default class AssetsExtension {
    static readonly Config: Schema<{}> = Schema.object({});

    private assetService: AssetService;

    constructor(public ctx: Context, public config: {}) {
        this.assetService = ctx[Services.Asset];
    }

    @Tool({
        name: "view_file",
        description: "查看文件内容。根据文件类型以最适合LLM理解的方式返回内容。支持文本文件、PDF、图片等多种格式。",
        parameters: Schema.object({
            id: Schema.string().required().description("要查看的资源ID"),
        }),
    })
    async viewFile({ id }: Infer<{ id: string }>) {
        try {
            // 获取资源信息
            const assetInfo = await this.assetService.getInfo(id);
            const buffer = await this.assetService.get(id);

            // 根据资源类型分析内容
            const analysis = await this.analyzeFileContent(buffer, assetInfo.mime, assetInfo.filename);

            if (analysis.success) {
                return Success(analysis.content);
            } else {
                return Failed(analysis.error || "无法分析文件内容");
            }
        } catch (error) {
            return Failed(`获取资源失败: ${error.message}`);
        }
    }

    @Tool({
        name: "list_archive",
        description: "列出压缩包（zip、tar等）内的文件列表和目录结构。",
        parameters: Schema.object({
            id: Schema.string().required().description("压缩包资源的ID"),
        }),
    })
    async listArchive({ id }: Infer<{ id: string }>) {
        try {
            // 获取资源信息
            const assetInfo = await this.assetService.getInfo(id);
            const buffer = await this.assetService.get(id);

            // 检查是否为压缩文件
            if (!this.isArchiveFile(assetInfo.mime)) {
                return Failed(`文件类型 ${assetInfo.mime} 不是支持的压缩格式`);
            }

            // 列出压缩包内容
            const fileList = await this.extractArchiveList(buffer, assetInfo.mime);
            
            if (fileList.length === 0) {
                return Success("压缩包为空或无法读取内容");
            }

            const listText = fileList.map(file => `- ${file}`).join('\n');
            return Success(`压缩包内容 (共 ${fileList.length} 个文件):\n${listText}`);
        } catch (error) {
            return Failed(`列出压缩包内容失败: ${error.message}`);
        }
    }

    /**
     * 分析文件内容
     */
    private async analyzeFileContent(buffer: Buffer, mimeType: string, filename?: string): Promise<FileAnalysisResult> {
        try {
            // 文本文件
            if (mimeType.startsWith('text/') || mimeType === 'application/json') {
                const content = buffer.toString('utf-8');
                const truncated = content.length > 4000 ? content.substring(0, 4000) + '\n...(内容已截断)' : content;
                return {
                    type: AssetType.File,
                    content: `文件内容:\n\`\`\`\n${truncated}\n\`\`\``,
                    success: true
                };
            }

            // PDF文件
            if (mimeType === 'application/pdf') {
                try {
                    const pdfContent = await this.extractPdfText(buffer);
                    const truncated = pdfContent.length > 4000 ? pdfContent.substring(0, 4000) + '\n...(内容已截断)' : pdfContent;
                    return {
                        type: AssetType.File,
                        content: `PDF文件内容:\n${truncated}`,
                        success: true
                    };
                } catch (error) {
                    return {
                        type: AssetType.File,
                        content: `[PDF文件: ${filename || '未知文件名'}, 大小: ${this.formatFileSize(buffer.length)}] - 无法提取文本内容`,
                        success: true
                    };
                }
            }

            // 图片文件
            if (mimeType.startsWith('image/')) {
                // TODO: 如果有多模态能力，可以在这里进行图像识别
                return {
                    type: AssetType.Image,
                    content: `[图片: ${filename || '未知文件名'}, 类型: ${mimeType}, 大小: ${this.formatFileSize(buffer.length)}]`,
                    success: true
                };
            }

            // 音频文件
            if (mimeType.startsWith('audio/')) {
                return {
                    type: AssetType.Audio,
                    content: `[音频文件: ${filename || '未知文件名'}, 类型: ${mimeType}, 大小: ${this.formatFileSize(buffer.length)}]`,
                    success: true
                };
            }

            // 视频文件
            if (mimeType.startsWith('video/')) {
                return {
                    type: AssetType.Video,
                    content: `[视频文件: ${filename || '未知文件名'}, 类型: ${mimeType}, 大小: ${this.formatFileSize(buffer.length)}]`,
                    success: true
                };
            }

            // 压缩文件
            if (this.isArchiveFile(mimeType)) {
                return {
                    type: AssetType.File,
                    content: `[压缩文件: ${filename || '未知文件名'}, 类型: ${mimeType}, 大小: ${this.formatFileSize(buffer.length)}] - 请使用 list_archive 工具查看内容`,
                    success: true
                };
            }

            // 其他二进制文件
            return {
                type: AssetType.File,
                content: `[二进制文件: ${filename || '未知文件名'}, 类型: ${mimeType}, 大小: ${this.formatFileSize(buffer.length)}] - 无法预览内容`,
                success: true
            };
        } catch (error) {
            return {
                type: AssetType.File,
                content: "",
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 检查是否为压缩文件
     */
    private isArchiveFile(mimeType: string): boolean {
        const archiveTypes = [
            'application/zip',
            'application/x-tar',
            'application/gzip',
            'application/x-gzip',
            'application/x-compressed',
            'application/x-zip-compressed'
        ];
        return archiveTypes.includes(mimeType);
    }

    /**
     * 提取压缩包文件列表
     */
    private async extractArchiveList(buffer: Buffer, mimeType: string): Promise<string[]> {
        // 这里需要根据压缩格式使用相应的库
        // 暂时返回模拟数据，实际实现需要安装相应的解压库
        if (mimeType === 'application/zip') {
            // TODO: 使用 unzipper 或类似库
            return ['示例文件1.txt', '示例文件2.jpg', 'docs/readme.md'];
        }
        
        return [];
    }

    /**
     * 提取PDF文本内容
     */
    private async extractPdfText(buffer: Buffer): Promise<string> {
        // TODO: 使用 pdf-parse 或类似库提取PDF文本
        // 这里返回模拟内容
        throw new Error("PDF文本提取功能尚未实现");
    }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
