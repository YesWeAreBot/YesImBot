import type { Logger } from "koishi";

// GitHub API 工具类
export class GitHubAPI {
    private logger: Logger;
    private http: any;

    constructor(logger: Logger, http: any) {
        this.logger = logger;
        this.http = http;
    }

    /**
     * 获取 GitHub 仓库的最新版本
     */
    async getLatestVersion(owner: string, repo: string): Promise<string | null> {
        try {
            const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
            this.logger.debug(`获取最新版本: ${owner}/${repo}`);

            const response = await this.http.get(url, {
                headers: { "User-Agent": "KoishiMCPPlugin/2.0.0" },
            });

            if (response?.tag_name) {
                this.logger.debug(`找到最新版本: ${response.tag_name}`);
                return response.tag_name;
            }

            return null;
        } catch (error: any) {
            this.logger.error(`获取版本失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 构建下载 URL
     */
    buildDownloadUrl(owner: string, repo: string, version: string, filename: string, githubMirror?: string): string {
        const baseUrl = githubMirror || "https://github.com";
        return `${baseUrl}/${owner}/${repo}/releases/download/${version}/${filename}`;
    }
}
