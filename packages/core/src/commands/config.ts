import { Context, h } from "koishi";

import { Config } from "../config";
import { checkConfiguration, findBrokenModelReferences } from "./config-check";
import { ConfigPathError, listConfigFields, parseConfigPath, parseConfigValue, resolveConfigPath, safeConfigValue, writeConfigValue } from "./config-path";

export const name = "yesimbot.command.config";
const pathHelp = "配置路径使用点号访问对象、方括号访问数组，数组索引从 0 开始，例如 providers[0].models[0].modelId。";
const authority = { authority: 3 };
const shortError = (error: unknown) => (error instanceof ConfigPathError ? error.message : "配置读取失败，请检查配置路径。");
const maxPage = 1700;

function formatConfigOutput(output: string): ReturnType<typeof h.text> {
    if (output.length <= maxPage) return h.text(output);
    return h.text(output.slice(0, maxPage) + "\n输出过长，追加子路径以缩小范围。");
}

async function waitForReload(ready: Promise<void>): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            ready.then(() => true),
            new Promise<false>((resolve) => {
                timeout = setTimeout(() => resolve(false), 5000);
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

export function apply(ctx: Context, config: Config) {
    ctx.command("conf", "查看和调整 YesImBot 配置", authority)
        .usage(`${pathHelp}\nconf.list 列出配置项，conf.get 读取，conf.set 修改，conf.check 检查模型引用。`)
        .action(() => "使用 conf.list [路径]、conf.get <路径>、conf.set <路径> <值> 或 conf.check。");
    ctx.command("conf.check", "检查模型引用、任务分配与能力声明（不发起模型请求）", authority)
        .usage("示例：conf.check。此命令只检查本地声明，不连接提供商。")
        .action(() => checkConfiguration(config));
    ctx.command("conf.list [key:string]", "列出可调整的配置路径、类型和状态", authority)
        .usage(`${pathHelp}\n不填路径列出一级配置项。示例：conf.list providers[0].models[0]。`)
        .option("page", "-p <page:posint> 查询第几页，默认第 1 页")
        .action(({ options }, key) => {
            try {
                const keys = key ? parseConfigPath(key) : [];
                const node = resolveConfigPath(ctx, config, keys);
                const lines = listConfigFields(ctx, node, keys);
                if (!lines.length) return "该路径下没有子配置项，可使用 conf.get 读取。";
                const size = 12;
                const total = Math.ceil(lines.length / size);
                const page = options?.page ?? 1;
                if (page > total) return `只有 ${total} 页。`;
                return formatConfigOutput([`配置项 · 第 ${page}/${total} 页`, ...lines.slice((page - 1) * size, page * size)].join("\n"));
            } catch (error) {
                return shortError(error);
            }
        });
    ctx.command("conf.get [key:string]", "读取配置值，隐藏凭据和地址", authority)
        .usage(`${pathHelp}\n示例：conf.get heartbeat。`)
        .action((_, key) => {
            if (!key) return "请输入有效的配置键";
            try {
                const keys = parseConfigPath(key);
                const value = safeConfigValue(ctx, resolveConfigPath(ctx, config, keys), keys);
                if (value === undefined) return "配置项尚未设置。";
                const output = JSON.stringify(value, null, 2);
                // Preserve short text replies used by existing configuration scripts.
                return output.length <= maxPage && !/[<>]/.test(output) ? output : formatConfigOutput(output);
            } catch (error) {
                return shortError(error);
            }
        });

    ctx.command("conf.set [key:string] [value:text]", "校验并修改指定配置项", authority)
        .usage(`${pathHelp}\n值按配置类型解释：字符串可直接输入，布尔值用 true 或 false，对象和数组用 JSON。示例：conf.set heartbeat 7。`)
        .option("force", "-f <force:boolean> 强制重载插件")
        .action(async ({ options }, key, value) => {
            if (!key) return "请输入有效的配置键";
            if (value === undefined) return "请输入有效的值";
            let data: Config;
            let keys: ReturnType<typeof parseConfigPath>;
            try {
                keys = parseConfigPath(key);
                const node = resolveConfigPath(ctx, config, keys);
                const replacement = parseConfigValue(ctx, node, value, keys);
                data = Config(writeConfigValue(structuredClone(config), keys, replacement) as Config);
                if (["providers", "modelGroups", "task", "topics", "typesafe", "extra"].includes(String(keys[0]))) {
                    const existing = new Set(findBrokenModelReferences(config).map(({ signature }) => signature));
                    const broken = findBrokenModelReferences(data).find(({ signature }) => !existing.has(signature));
                    if (broken) return `未应用：${broken.path} ${broken.message}。请先处理该引用，详情见 conf.check。`;
                }
            } catch (error) {
                if (error instanceof ConfigPathError) return error.message;
                return "配置值未通过校验，未应用。请用 conf.list 查看相应路径要求的类型。";
            }
            const scope = ctx.scope.parent.scope;
            // Hold the original owner context so command disposal during reload does not
            // interfere with locating the newly installed plugin instance.
            const current = ctx.yesimbot;
            try {
                const before = scope.config;
                scope.update(data, options?.force ? true : undefined);
                if (scope.config === before) return "配置未应用：框架未接受更新。";
                if (scope.error) return "配置已写入框架，但重载失败。请查看控制台错误。";
                config = scope.config as Config;
                const live = scope.ctx.yesimbot;
                if (current && (!live || live[Context.current].scope !== scope || live === current)) {
                    return "配置已保存，运行实例尚未确认重载。请在控制台查看插件状态。";
                }
                if (live && live[Context.current].scope === scope) {
                    if (!(await waitForReload(live.ready))) return "配置已保存，插件仍在启动。请在控制台查看插件状态。";
                    if (!live.isReady) return "配置已保存，但插件重载后未就绪。请查看控制台错误。";
                }
                return "设置成功";
            } catch {
                ctx.logger.warn("配置命令更新框架作用域失败。");
                return "配置更新失败。请查看控制台中的插件状态。";
            }
        });
}
