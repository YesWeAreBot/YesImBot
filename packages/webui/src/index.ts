import { } from "@koishijs/plugin-console";
import { Context } from "koishi";
import { resolve } from "path";

export const inject = {
    required: [
        'console',
        'yesimbot'
    ]
};

export async function apply(ctx: Context) {
    // 注册前端入口
    ctx.console.addEntry({
        dev: resolve(__dirname, '../client/index.ts'),
        prod: resolve(__dirname, '../dist'),
    })
}