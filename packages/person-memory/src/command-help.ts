import type { Command } from "koishi";

/** Shared guidance for the scene and shared-domain command registrations. */
export function describePeopleCommand(command: Command, declaration: string, shared: boolean): Command {
    const name = declaration.split(" ")[0];
    const values: Record<string, string> = {
        ref: "123456",
        account: "123456",
        person: "人物UUID",
        name: "许仙",
        profile: '"喜欢 Python，常聊机器人"',
        mode: "review",
        from: "来源人物UUID",
        into: "目标人物UUID",
        target: "人物UUID",
        confidence: "0.9",
        query: "上次旅行",
        offset: "0",
        id: ["people.pending", "people.approve", "people.reject"].includes(name) ? "候选编号" : "审计编号",
        revision: "1",
    };
    const example = declaration
        .replace(/\[[^\]]+\]/g, "")
        .replace(/<([^>]+)>/g, (_match, parameter: string) => values[parameter.split(":")[0]] ?? "参数值")
        .trim();
    const notes = [
        "权限：Koishi 管理员（等级至少为 3）。",
        shared ? "范围：当前共同记忆域，相关修改可能影响域内其他场景；回忆仍受当前配置的会话权限限制。" : "范围：当前平台、机器人及群聊或私聊场景。",
        "参数：ref/target 使用账号 ID 或人物 UUID；account 使用账号 ID，不能用昵称代替；先执行 people.list 获取人物 UUID。多个参数以空格分隔，含空格的内容请加引号。",
        shared
            ? '跨平台账号：用单引号包住 JSON，例如 people.show \'["onebot","123456"]\'。'
            : "账号 ID 指当前平台的账号；人物 UUID 来自 people.list 或 people.create 的返回结果。",
        "常用入口：people.status 查看模式与任务状态；people.pending 查看候选；people.history 查看审计；people.show -h 查看完整帮助。",
    ];
    if (["people.edit", "people.clear", "people.merge", "people.split", "people.unbind", "people.archive", "people.revert", "people.bind"].includes(name))
        notes.push(
            "修改前请用 people.show 查看档案并核对账号归属；清空画像、解除关联、归档和删除聊天历史是不同操作。revert 受后续版本冲突限制，并非任意回滚。",
        );
    if (name === "people.mode")
        notes.push(
            "不填参数查看当前模式；设置用法：people.mode review。模式：off 停止记忆功能并保留数据；review 提交候选后人工审核；auto 自动维护，仍可暂停或人工纠正。既有候选不会因切换模式而自动批准。",
        );
    if (name === "people.summarize") notes.push("后台总结需要选择有效的核心模型组，并已积累可用来源；总结完成不一定立即改变画像，review 模式需审核候选。");
    if (["people.pending", "people.approve", "people.reject"].includes(name)) notes.push("候选编号来自 people.pending，不能用人物 UUID 或账号 ID 代替。");
    if (["people.history", "people.revert"].includes(name))
        notes.push("审计编号来自 people.history；不填 history 的编号时分页查看记录。--account 筛选账号，--person 筛选人物 UUID。");
    if (name === "people.archive")
        notes.push("不填 revision 仅预览。执行前先查询当前画像版本，再用 people.archive 账号ID 当前版本号确认；不能照抄其他档案的版本号。");
    command.usage(notes.join("\n"));
    command.example(name === "people" ? "people.list" : example);
    if (name === "people") command.example("people.show 123456");
    if (name === "people.mode") command.example("people.mode review");
    if (name === "people.list") command.example("people.list 20");
    if (name === "people.history") command.example("people.history --page 2 --account 123456");
    return command;
}
