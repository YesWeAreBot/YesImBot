import { expect, it } from "vitest";

import { apply } from "../src/commands/config";

function check(config: any) {
    const actions = new Map<string, Function>();
    const ctx: any = {
        command: (definition: string) => {
            const command: any = {
                option: () => command,
                action: (action: Function) => {
                    actions.set(definition.split(" ")[0], action);
                    return command;
                },
            };
            return command;
        },
    };
    apply(ctx, config);
    const action = actions.get("conf.check");
    expect(action).toBeTypeOf("function");
    return action!({});
}
const provider = {
    name: "main",
    type: "OpenAI",
    apiKey: "SECRET_MUST_NOT_APPEAR",
    baseURL: "https://secret-endpoint.example/",
    models: [{ modelId: "chat", abilities: ["对话", "函数调用"] }],
};
const group = { name: "chat", models: [{ providerName: "main", modelId: "chat" }] };
it("reports missing references without echoing credentials or endpoint", async () => {
    const result = await check({
        providers: [provider],
        modelGroups: [group, { name: "broken", models: [{ providerName: "missing", modelId: "unknown" }] }],
        task: { chat: "absent" },
    });
    expect(result).toContain("missing");
    expect(result).toContain("absent");
    expect(result).not.toContain(provider.apiKey);
    expect(result).not.toContain(provider.baseURL);
});
it("explains declared capabilities and missing embedding without changing config", async () => {
    const config = { providers: [provider], modelGroups: [group], task: { chat: "chat" }, l2_memory: { enabled: true } };
    const before = JSON.stringify(config);
    const result = await check(config);
    expect(result).toContain("main / chat");
    expect(result).toContain("声明");
    expect(result).toContain("嵌入");
    expect(JSON.stringify(config)).toBe(before);
});
it("flags duplicate names and an embedding group containing chat-only models", async () => {
    const result = await check({
        providers: [provider, provider],
        modelGroups: [group, group],
        task: { chat: "chat", embed: "chat" },
        l2_memory: { enabled: true },
    });
    expect(result).toContain("名称重复");
    expect(result).toContain("没有声明嵌入能力");
});
