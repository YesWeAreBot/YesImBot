import { Context, Schema } from "koishi";

import { ImageCache } from "../managers/image";


export const name = "cache";
export interface Config { }
export const Config: Schema<Config> = Schema.object({});
export function apply(ctx: Context, config: Config) {
    ctx.command("cache", "图片缓存管理")
        .alias("图片缓存")
        .action(({ session }) => {
            return session?.execute("help cache");
        });

    ctx.command("cache.clean", "清理过期图片缓存", { authority: 3 })
        .alias("清理图片缓存")
        .option("days", "<days:number> 清理超过指定天数的缓存，默认7天", {
            fallback: 7,
        })
        .action(async ({ options }) => {
            const imageCache = ImageCache.instance;
            if (!imageCache) {
                return "图片缓存未初始化";
            }

            if (!options.days) {
                return "请指定要清理的天数";
            }

            const maxAge = options.days * 24 * 60 * 60 * 1000;
            const count = imageCache.cleanExpired(maxAge);
            return `已清理 ${count} 个过期缓存文件`;
        });

    ctx.command("cache.clear", "清除所有图片缓存", { authority: 3 })
        .alias("清除图片缓存")
        .action(() => {
            const imageCache = ImageCache.instance;
            if (!imageCache) {
                return "图片缓存未初始化";
            }

            imageCache.clear();
            return "已清除所有图片缓存";
        });
}
