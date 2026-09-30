import { Context, Session } from "koishi";

import { ReplyControl } from "./reply-control";

const categories = ["text", "at", "quote", "direct", "system", "scheduled", "background"];
interface Target {
    platform: string;
    selfId: string;
    channelId: string;
    isDirect?: boolean;
}
interface TargetOptions {
    platform?: string;
    bot?: string;
    group?: string;
    channel?: string;
    target?: string;
    user?: string;
}

async function resolveTarget(ctx: Context, control: ReplyControl, session: Session, options: TargetOptions): Promise<Target> {
    if (!session) throw new Error("无法确定当前会话，请在群聊或私聊中执行指令。");
    const selectors = [options.group, options.user, options.channel, options.target].filter((value) => value !== undefined);
    if (selectors.length > 1) throw new Error("-g、-u、-c、-t 不能同时使用。");
    if (selectors.some((value) => !value.trim())) throw new Error("目标ID不能为空。");

    let platform = options.platform;
    let channelId = options.channel || options.group;
    if (options.target !== undefined) {
        const separator = options.target.indexOf(":");
        if (separator <= 0 || separator === options.target.length - 1) throw new Error("目标格式应为 platform:channelId。");
        const targetPlatform = options.target.slice(0, separator);
        if (platform && platform !== targetPlatform) throw new Error("-p 与 -t 指定的平台不一致。");
        platform = targetPlatform;
        channelId = options.target.slice(separator + 1);
    }
    if (options.group?.startsWith("private:")) throw new Error("私聊目标请使用 -u，或用 -c/-t 指定实际私聊频道ID。");

    // Like history.clear, infer the platform only when the recorded target is unique.
    let matches = channelId ? control.find(channelId, platform) : [];
    if (!platform && options.channel) {
        const platforms = [...new Set(matches.map((rule) => rule.platform))];
        if (platforms.length > 1) throw new Error(`目标存在于多个平台：${platforms.join(", ")}，请使用 -p 或 -t 指定平台。`);
        if (platforms.length === 1) platform = platforms[0];
    }
    platform ||= session.platform;
    if (platform !== session.platform && !selectors.length) throw new Error("跨平台操作必须用 -c、-t、-g 或 -u 明确指定目标。");
    matches = channelId ? control.find(channelId, platform) : [];
    const bots = ctx.bots.filter((bot) => bot.platform === platform);
    if (!bots.length) throw new Error(`未找到平台 ${platform} 上的机器人。`);
    let selfId = options.bot;
    if (!selfId) {
        if (platform === session.platform) selfId = session.selfId || session.bot?.selfId;
        else {
            const ruleBots = [...new Set(matches.map((rule) => rule.selfId))];
            if (ruleBots.length === 1) selfId = ruleBots[0];
            else if (ruleBots.length === 0 && bots.length === 1) selfId = bots[0].selfId;
            else throw new Error("目标平台有多个机器人，请使用 -b 明确指定机器人账号。");
        }
    }
    const bot = bots.find((bot) => bot.selfId === selfId);
    if (!bot) throw new Error(`未找到平台 ${platform} 上的机器人 ${selfId || "（未指定）"}。`);

    let isDirect = matches.find((rule) => rule.selfId === selfId)?.isDirect;
    if (options.user) {
        const userId = options.user.replace(/^private:/, "");
        if (!userId) throw new Error("私聊用户ID不能为空。");
        if (!bot.createDirectChannel) throw new Error("目标适配器不支持按用户定位私聊，请在目标私聊中调用命令。");
        channelId = (await bot.createDirectChannel(userId)).id;
        isDirect = true;
    } else if (!channelId) {
        channelId = session.channelId;
        isDirect = session.isDirect;
    } else if (options.group) isDirect = false;
    else if (channelId.startsWith("private:")) isDirect = true;
    if (!platform || !selfId || !channelId?.trim()) throw new Error("目标信息不完整，请明确指定会话ID。");
    return { platform, selfId, channelId, isDirect };
}

function parseDuration(value: string | undefined, defaultDuration: number): number | null {
    if (value === undefined) return defaultDuration;
    const input = value.trim().toLowerCase();
    if (["permanent", "forever", "永久"].includes(input)) return null;
    const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|毫秒|秒|分钟|分|小时|时|天)?$/.exec(input);
    if (!match) throw new Error("时长格式错误，可使用 60、30s、1m、2h、1d 或 permanent（永久）。");
    const units: Record<string, number> = {
        ms: 1,
        s: 1000,
        m: 60000,
        h: 3600000,
        d: 86400000,
        毫秒: 1,
        秒: 1000,
        分钟: 60000,
        分: 60000,
        小时: 3600000,
        时: 3600000,
        天: 86400000,
    };
    const duration = Number(match[1]) * units[match[2] || "s"];
    if (!Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(Date.now() + duration)) {
        throw new Error("暂停时长必须是大于零的有效时长，精度最小为 1 毫秒。");
    }
    return duration;
}

function parseCategories(value: string): string[] {
    const values = value.split(/[,，\s]+/).filter(Boolean);
    if (!values.length) throw new Error("类别不能为空。");
    if (values.some((item) => item !== "all" && !categories.includes(item))) {
        throw new Error(`类别无效，可使用 ${categories.join(", ")} 或 all。`);
    }
    if (values.includes("all")) {
        if (values.length !== 1) throw new Error("all 不能与其他类别混用。");
        return [...categories];
    }
    return [...new Set(values)];
}

function describe(target: Target): string {
    return `${target.platform}:${target.selfId}:${target.channelId}`;
}

export function registerReplyCommands(ctx: Context, control: ReplyControl, defaultDuration: number): void {
    const root = ctx.command("chat", "聊天回复管理", { authority: 3 });
    const addTargetOptions = (command: ReturnType<Context["command"]>) =>
        command
            .option("platform", "-p <platform:string> 目标平台")
            .option("bot", "-b <bot:string> 目标机器人账号（有多个候选时指定）")
            .option("channel", "-c <channel:string> 实际会话ID，平台唯一时自动识别")
            .option("target", "-t <target:string> 指定目标 platform:channelId")
            .option("group", "-g <group:string> 目标群/频道ID")
            .option("user", "-u <user:string> 目标私聊用户ID");

    addTargetOptions(root.subcommand(".pause [duration:string]", "暂停聊天回复", { authority: 3 }))
        .option("block", "--block <categories:string> 抑制类别，以逗号分隔")
        .option("allow", "--allow <categories:string> 仅允许这些类别，以逗号分隔")
        .usage("不带参数时暂停当前会话，使用配置中的默认时长。时长数字按秒计算，permanent 表示永久。--block 与 --allow 不能同时使用。")
        .example("chat.pause")
        .example("chat.pause 5m --allow at")
        .example("chat.pause permanent -p onebot -b 123456 -g 654321")
        .action(async ({ session, options }, duration) => {
            try {
                if (options.block !== undefined && options.allow !== undefined) throw new Error("--block 与 --allow 不能同时使用。");
                const milliseconds = parseDuration(duration, defaultDuration);
                let blocked = [...categories];
                if (options.block !== undefined) blocked = parseCategories(options.block);
                if (options.allow !== undefined) {
                    const allowed = parseCategories(options.allow);
                    blocked = categories.filter((category) => !allowed.includes(category));
                }
                const target = await resolveTarget(ctx, control, session, options);
                await control.set(target, blocked, milliseconds);
                const rule = control.get(target);
                const ending =
                    rule?.expiresAt === null
                        ? "永久生效，直到主动解除"
                        : `恢复时间：${new Date(rule?.expiresAt ?? Date.now() + milliseconds).toLocaleString("zh-CN")}`;
                return `已更新 ${describe(target)} 的回复规则。\n抑制类别：${blocked.join(", ") || "无"}\n${ending}。消息与事件继续记录，其他指令正常使用。`;
            } catch (error) {
                return `操作失败：${error.message}`;
            }
        });

    addTargetOptions(root.subcommand(".resume", "解除聊天回复抑制", { authority: 3 })).action(async ({ session, options }) => {
        try {
            const target = await resolveTarget(ctx, control, session, options);
            const resumed = await control.resume(target);
            return resumed
                ? `已解除 ${describe(target)} 的回复抑制，意愿从零开始积累。`
                : `${describe(target)} 当前没有生效的回复抑制规则。`;
        } catch (error) {
            return `操作失败：${error.message}`;
        }
    });

    addTargetOptions(root.subcommand(".status", "查看聊天回复抑制状态", { authority: 3 })).action(async ({ session, options }) => {
        try {
            const target = await resolveTarget(ctx, control, session, options);
            const rule = control.get(target);
            if (!rule) return `${describe(target)} 当前没有生效的回复抑制规则。`;
            return `${describe(target)}\n抑制类别：${rule.blocked.join(", ") || "无"}\n${rule.expiresAt === null ? "永久生效" : `恢复时间：${new Date(rule.expiresAt).toLocaleString("zh-CN")}`}。`;
        } catch (error) {
            return `查询失败：${error.message}`;
        }
    });
}
