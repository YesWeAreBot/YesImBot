import { readFileSync } from "node:fs";

import { expect, it, onTestFinished } from "vitest";

import DailyPlannerExtension from "../../daily-planner/src/index";
import { escapeContext } from "../../person-memory/src/context";
import { apply as applyPersonMemory } from "../../person-memory/src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../../person-memory/src/store";
import { fixture } from "../../person-memory/tests/helpers";
import { PromptService } from "../src/prompt/service";
import { loggingStub } from "./helpers/yesimbot";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const syntax = "{{session.bot.config.token}} {{#unclosed}} {{> agent.system}}";
const session: any = {
    platform: "onebot",
    channelId: "g",
    selfId: "bot",
    userId: "u",
    isDirect: false,
    content: "hello",
    author: { id: "u", name: "User" },
    bot: { selfId: "bot", config: { token: "FAKE_SECRET_MUST_NOT_LEAK" } },
};

it.each([false, true])("keeps real person-memory injection data literal with sharedMemory=%s", async (sharedMemory) => {
    let prompt!: PromptService;
    const app = await fixture({ onTestFinished } as any, (ctx) => {
        prompt = new PromptService(ctx, { injectionPlaceholder: "extensions" } as any, loggingStub(logger));
        Object.defineProperty(ctx, "bots", {
            value: [
                { platform: "onebot", selfId: "bot", session: (event: any) => ({ ...event, channelId: event.channel.id, isDirect: event.channel.type === 1 }) },
            ],
        });
        ctx.set("yesimbot", {
            prompt,
            tool: { capabilities: { trustedToolSession: 1 }, registerTool: () => () => {}, unregisterTool() {} },
            world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => true },
        });
        ctx.plugin({
            inject: ["database", "yesimbot"],
            apply: (ready) =>
                applyPersonMemory(ready, {
                    enabled: true,
                    mode: "auto",
                    sharedMemory,
                    modelGroup: "",
                    summaryThreshold: 6,
                    cooldownSeconds: 600,
                    timeoutSeconds: 30,
                    maxQueue: 32,
                    recallScope: "current",
                    profileSystemPrompt: `PROFILE_POLICY ${syntax}`,
                } as any),
        });
    });
    await prompt.start();
    const store = new PersonStore(app.database, "auto");
    const scope = sharedMemory ? mindScope(session) : sceneKey(session);
    const ref = sharedMemory ? accountRef(session.platform, session.userId) : session.userId;
    await store.recognize(scope, ref, "Profile owner");
    await store.setProfile(scope, ref, `PROFILE_DATA ${syntax}`, "admin");
    prompt.registerTemplate("agent.system", "{{extensions}}");
    const rendered = await prompt.render("agent.system", { session });
    expect(rendered).toContain("PROFILE_DATA");
    expect(rendered).toContain(escapeContext(syntax));
    expect(rendered).toContain(`PROFILE_POLICY ${syntax}`);
    expect(rendered).not.toContain("FAKE_SECRET_MUST_NOT_LEAK");
});

it("keeps real daily-plan injection data literal while resolving the trusted clock value", async (t) => {
    let prompt!: PromptService;
    await fixture(t, (ctx) => {
        prompt = new PromptService(ctx, { injectionPlaceholder: "extensions" } as any, loggingStub(logger));
        (ctx as any).cron = () => () => {};
        ctx.set("yesimbot", {
            prompt,
            memory: {},
            model: { useChatModel: () => null },
            tool: { register() {}, unregister() {} },
        });
        const extension = new DailyPlannerExtension(ctx, {
            scheduleGenerationTime: "03:00",
            model: { providerName: "none", modelId: "none" },
            coreMemoryLabel: [],
            characterName: "Bot",
            coreMemoryWeight: 0.7,
        });
        (extension as any).service.getCurrentTimeSegment = async () => ({ start: "00:00", end: "23:59", content: `PLAN_DATA ${syntax}` });
    });
    await prompt.start();
    const rendered = await prompt.renderRaw("{{extensions}}", { session, date: { now: "TEST_CLOCK" } });
    expect(rendered).toContain("PLAN_DATA");
    expect(rendered).toContain(syntax);
    expect(rendered).not.toContain("FAKE_SECRET_MUST_NOT_LEAK");
    expect(rendered).not.toContain("{{ date.now }}");
    expect(rendered).toContain("现在是 ");
});

it.each([
    [false, "LF"],
    [true, "LF"],
    [true, "CRLF"],
] as const)("migrates only the exact saved legacy default in native mode=%s with %s", async (native, lineEndings) => {
    const prompt = new PromptService({} as any, {} as any, loggingStub(logger));
    const original = readFileSync(new URL("./fixtures/legacy-system-template.txt", import.meta.url), "utf8");
    const legacy = lineEndings === "CRLF" ? original.replace(/\r?\n/g, "\r\n") : original;
    prompt.registerTemplate("agent.system", legacy);
    const rendered = await prompt.render("agent.system", { NATIVE_TOOL_CALLING: native, MEMORY_BLOCKS: [{ label: "persona", content: ["CUSTOM_PERSONA"] }] });
    expect(rendered).toContain("CUSTOM_PERSONA");
    expect(rendered).not.toContain("You are Athena ReAct agent");
    expect(rendered.includes("Your output MUST be a single raw")).toBe(!native);
    expect(rendered.includes("Execute actions through the native tool interface")).toBe(native);
    prompt.registerTemplate("agent.system", `${legacy}\nCUSTOM_PRESET_SUFFIX`);
    const custom = await prompt.render("agent.system", { NATIVE_TOOL_CALLING: native });
    expect(custom).toContain("CUSTOM_PRESET_SUFFIX");
    expect(custom).toContain("You are Athena ReAct agent");
    expect(custom).toContain("Your output MUST be a single raw");
});
