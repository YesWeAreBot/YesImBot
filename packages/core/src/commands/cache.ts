import { unlinkSync } from "fs";
import { $, Context } from "koishi";
import path from "path";
import { IMAGE_TABLE } from "../shared";

export const name = "yesimbot.command.cache";

export function apply(ctx: Context) {
    const cachePath = path.join(ctx.baseDir, "data", "yesimbot", "image_cache");

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
            if (!options.days) {
                return "请指定要清理的天数";
            }

            const maxAge = options.days * 24 * 60 * 60 * 1000;
            const count = await _cleanExpired(maxAge);
            return `已清理 ${count} 个过期缓存文件`;
        });

    ctx.command("cache.clear", "清除所有图片缓存", { authority: 3 })
        .alias("清除图片缓存")
        .action(async () => {
            await _clear();
            return "已清除所有图片缓存";
        });

    async function _delete(id: string) {
        const result = await this.ctx.database.remove(IMAGE_TABLE, { id });
        if (result.removed) unlinkSync(path.join(cachePath, id));
    }

    async function _clear() {
        const images = await this.ctx.database.get(IMAGE_TABLE, {});

        for (let image of images) {
            unlinkSync(path.join(cachePath, image.id));
        }

        await this.ctx.database.drop(IMAGE_TABLE);
    }

    /**
     * 清理过期缓存
     * @param maxAge 最大缓存时间(毫秒)，默认7天
     */
    async function _cleanExpired(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
        const now = Date.now();

        const images = await this.ctx.database.get(IMAGE_TABLE, (row) => $.and($.lt(row.timestamp, new Date(now - maxAge))));

        for (let image of images) {
            await this.delete(image.id);
        }

        return images.length;
    }
}
