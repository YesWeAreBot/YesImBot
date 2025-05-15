import { Context } from "koishi";

import { Agent } from "./agent";
import { Config } from "./config";


export const name = "yesimbot";
export const usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 llama-3.1-405b 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;
export { Config } from "./config";
export const inject = {
    required: ["database"],
}

export async function apply(ctx: Context, config: Config) {
    // 初始化Agent
    const agent = new Agent(ctx, config);

    ctx.on('ready', () => {
        // agent.start();
    });

    ctx.on('dispose', () => {
        // agent.dispose();
    });
}


export * from "./extensions";