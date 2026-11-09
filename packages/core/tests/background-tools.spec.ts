import { Bot, Context, Schema } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { withReplyTurn, guardReplySession } from "../src/agent/reply-turn";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

async function fixture(enabled = true) {
    const ctx = new Context();
    let allowed = true,
        generation = 0;
    const watchers = new Set<() => void>();
    const receipts: any[] = [],
        completions: any[] = [];
    const world = {
        isChannelAllowed: () => allowed,
        stimulusOwnerId: "instance",
        l2_manager: {
            getHistoryGeneration: () => generation,
            watchHistory: (_target: unknown, fn: () => void) => {
                watchers.add(fn);
                return () => watchers.delete(fn);
            },
        },
        recordSystemEvent: async (event: unknown, expected: number) => {
            if (expected !== undefined && expected !== generation) return false;
            receipts.push(event);
            return true;
        },
    };
    const config: any = {
        backgroundTools: {
            enabled,
            allowedTools: ["read_slow"],
            completion: "next_cycle",
            settlement: "request",
            willingness: { succeeded: 2, failed: 0, cancelled: 0 },
            maxConcurrent: 4,
            maxRetained: 20,
            timeoutMs: 5000,
        },
    };
    let bot!: Bot;
    const fork = ctx.plugin((scope) => {
        bot = new (class extends Bot {})(scope, {}, "telegram");
        bot.selfId = "bot";
    });
    await ctx.start();
    const session = bot.session({
        type: "message",
        channel: { id: "7", type: 0 },
        guild: { id: "-1001" },
        user: { id: "u" },
        message: { id: "m", content: "source" },
    });
    const tools = new ToolService(ctx, config, { world, logging: loggingStub() } as any);
    ctx.on("agent/stimulus", (s, owner) => {
        completions.push({ s, owner });
    });
    onTestFinished(async () => {
        await tools.stop();
        await fork.dispose();
        await ctx.stop();
    });
    return {
        tools,
        session,
        bot,
        config,
        receipts,
        completions,
        revoke: () => (allowed = false),
        clear: () => {
            generation++;
            for (const fn of [...watchers]) fn();
        },
    };
}
const deferred = () => {
    let resolve!: (x?: any) => void;
    const promise = new Promise<any>((r) => (resolve = r));
    return { promise, resolve };
};
async function drain() {
    for (let i = 0; i < 15; i++) await Promise.resolve();
}
function add(f: Awaited<ReturnType<typeof fixture>>, execute: any, background = true) {
    f.tools.registerTool({
        name: "read_slow",
        description: "read",
        parameters: Schema.object({ value: Schema.string().default("ok") }),
        execute,
        background,
    } as any);
}
it("hides background management when disabled and keeps direct execution serial", async () => {
    const f = await fixture(false),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success", result: "done" };
    });
    expect(f.tools.getAvailableTools(f.session).some((t) => t.name === "background_task_start")).toBe(false);
    let done = false;
    const p = f.tools.invoke("read_slow", {}, f.session).then(() => (done = true));
    await drain();
    expect(done).toBe(false);
    d.resolve();
    await p;
    expect(done).toBe(true);
});
it("accepts opt-in work, exposes progress and full results, and detaches from the foreground turn", async () => {
    const f = await fixture(),
        d = deferred(),
        controller = new AbortController();
    let jobSignal!: AbortSignal;
    add(f, async ({ toolContext }: any) => {
        jobSignal = toolContext.signal;
        toolContext.reportProgress("retrieving");
        await d.promise;
        return { status: "success", result: "found" };
    });
    const start: any = await withReplyTurn(
        () => !controller.signal.aborted,
        () => f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, guardReplySession(f.session)),
        controller.signal,
    );
    expect(start, JSON.stringify(start)).toMatchObject({ status: "success" });
    const id = start.result.id;
    controller.abort();
    await drain();
    expect(jobSignal.aborted).toBe(false);
    const running: any = await f.tools.invoke("background_task_query", { id }, f.session);
    expect(running.result.state).toBe("running");
    expect(running.result.progress).toBe("retrieving");
    d.resolve();
    await drain();
    const done: any = await f.tools.invoke("background_task_query", { id }, f.session);
    expect(done.result.state).toBe("succeeded");
    expect(done.result.result.result).toBe("found");
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0].owner).toBe("instance");
});
it("rejects serial and management targets before execution", async () => {
    const f = await fixture();
    let calls = 0;
    add(
        f,
        async () => {
            calls++;
            return { status: "success" };
        },
        false,
    );
    for (const tool of ["read_slow", "background_task_start", "send_message"]) {
        expect((await f.tools.invoke("background_task_start", { tool, params: {} }, f.session)).status).toBe("error");
    }
    expect(calls).toBe(0);
});
it("keeps jobs isolated by Telegram parent guild and bot", async () => {
    const f = await fixture(),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success" };
    });
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    const other = f.bot.session({ channel: { id: "7", type: 0 }, guild: { id: "-1002" }, user: { id: "u" } });
    expect((await f.tools.invoke("background_task_query", { id: start.result.id }, other)).status).toBe("error");
    expect((await f.tools.invoke("background_task_cancel", { id: start.result.id }, other)).status).toBe("error");
    d.resolve();
    await drain();
});
it("model cancellation retains cancelling state until external work settles and ignores late success", async () => {
    const f = await fixture(),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success", result: "late" };
    });
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    const cancelled: any = await f.tools.invoke("background_task_cancel", { id: start.result.id }, f.session);
    expect(cancelled.result.state).toBe("cancelling");
    d.resolve();
    await drain();
    const result: any = await f.tools.invoke("background_task_query", { id: start.result.id }, f.session);
    expect(result.result.state).toBe("cancelled");
    expect(result.result.result).toBeUndefined();
});
it.each(["clear", "revoke"] as const)("invalidates task progress, results, receipts and wakeups after %s", async (change) => {
    const f = await fixture(),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success", result: "stale" };
    });
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    f[change]();
    d.resolve();
    await drain();
    expect((await f.tools.invoke("background_task_query", { id: start.result.id }, f.session)).status).toBe("error");
    expect(f.receipts.some((r) => r.payload.operation === "read_slow")).toBe(false);
    expect(f.completions).toEqual([]);
});
it("seals one foreground request after all sibling submissions and emits one aggregate completion", async () => {
    const f = await fixture(),
        a = deferred(),
        b = deferred();
    let n = 0;
    add(f, async () => {
        await (++n === 1 ? a.promise : b.promise);
        return { status: "success" };
    });
    const context = { requestId: "turn" };
    await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session, context);
    await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session, context);
    a.resolve();
    b.resolve();
    await drain();
    expect(f.completions).toEqual([]);
    f.tools.background!.sealRequest(f.session, "turn");
    await drain();
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0].s.payload.taskIds).toHaveLength(2);
});
it("preserves trusted completion ownership across scheduler payload copies and consumes the bonus once", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success", result: "done" }));
    await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    await drain();
    const original = f.completions[0].s.payload;
    const copy = { ...original, taskIds: [...original.taskIds] };
    expect(f.tools.background!.isCompletionCurrent(f.session, copy)).toBe(true);
    expect(f.tools.background!.consumeCompletion(f.session, copy)).toEqual({ gain: 2, wake: false });
    expect(f.tools.background!.consumeCompletion(f.session, original)).toBeUndefined();
    expect(f.tools.background!.isCompletionCurrent(f.session, JSON.parse(JSON.stringify(copy)))).toBe(false);
});
it("revokes completed task reads when a tool is unregistered", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success", result: "done" }));
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    await drain();
    f.tools.unregisterTool("read_slow");
    expect((await f.tools.invoke("background_task_query", { id: start.result.id }, f.session)).status).toBe("error");
});
it("uses the trusted execution context instead of model-supplied runtime fields", async () => {
    const f = await fixture();
    let signal: unknown, progress: unknown;
    add(f, async (args: any) => {
        signal = args.toolContext.signal;
        progress = args.toolContext.reportProgress;
        return { status: "success" };
    });
    const start: any = await f.tools.invoke(
        "background_task_start",
        { tool: "read_slow", params: { session: { channelId: "forged" }, toolContext: { signal: "fake", reportProgress: "fake" } } },
        f.session,
    );
    expect(start.status).toBe("success");
    await drain();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(progress).toBeTypeOf("function");
});
it("keeps task results scoped to one plugin service instance", async () => {
    const a = await fixture(),
        b = await fixture();
    add(a, async () => ({ status: "success", result: "private" }));
    const start: any = await a.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, a.session);
    await drain();
    expect((await b.tools.invoke("background_task_query", { id: start.result.id }, b.session)).status).toBe("error");
});
it("invalidates a queued completion when its original tool is removed", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success", result: "done" }));
    await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    await drain();
    const payload = f.completions[0].s.payload;
    f.tools.unregisterTool("read_slow");
    expect(f.tools.background!.isCompletionCurrent(f.session, payload)).toBe(false);
});
it("fences management results when history changes while their receipt is being published", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success", result: "private" }));
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    await drain();
    const late = deferred(),
        started = deferred();
    (f.tools as any).deps.world.recordSystemEvent = async (_event: unknown, generation: number) => {
        started.resolve();
        await late.promise;
        return generation === 0 ? false : true;
    };
    const result = f.tools.invoke("background_task_query", { id: start.result.id }, f.session);
    await started.promise;
    f.clear();
    late.resolve();
    expect((await result).status).toBe("error");
});
it("does not share private task results across users with the same native channel ID", async () => {
    const f = await fixture(),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success" };
    });
    const first = f.bot.session({ channel: { id: "shared-private-channel", type: 1 }, user: { id: "one" } });
    const other = f.bot.session({ channel: { id: "shared-private-channel", type: 1 }, user: { id: "two" } });
    const start: any = await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, first);
    expect(start.status).toBe("success");
    expect((await f.tools.invoke("background_task_query", { id: start.result.id }, other)).status).toBe("error");
    d.resolve();
    await drain();
});
it("retains administrator attribution for a manually submitted background tool", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success", result: "done" }));
    f.session.argv = { command: { name: "tool.invoke" } } as any;
    await f.tools.invoke("background_task_start", { tool: "read_slow", params: {} }, f.session);
    await drain();
    expect(f.receipts.find((receipt) => receipt.payload.operation === "read_slow").payload.actor).toBe("admin:telegram:u");
});

it("blocks unselected background tools without changing direct calls", async () => {
    const f = await fixture();
    let calls = 0;
    add(f, async () => {
        calls++;
        return { status: "success", result: "done" };
    });
    f.config.backgroundTools.allowedTools = [];
    expect((f.tools.background!.query(f.session) as any).tools).toEqual([]);
    expect(() => f.tools.background!.start(f.session, "read_slow", {})).toThrow("该工具不允许后台执行");
    expect(calls).toBe(0);
    expect((await f.tools.invoke("read_slow", {}, f.session)).status).toBe("success");
    expect(calls).toBe(1);
});
it("does not let selection authorize a tool without background support", async () => {
    const f = await fixture();
    add(f, async () => ({ status: "success" }), false);
    expect((f.tools.background!.query(f.session) as any).tools).toEqual([]);
    expect(() => f.tools.background!.start(f.session, "read_slow", {})).toThrow("该工具不允许后台执行");
});
it("invalidates a running task result when its background permission is revoked", async () => {
    const f = await fixture(),
        d = deferred();
    add(f, async () => {
        await d.promise;
        return { status: "success", result: "stale" };
    });
    const task = f.tools.background!.start(f.session, "read_slow", {});
    await drain();
    f.config.backgroundTools.allowedTools = [];
    d.resolve();
    await drain();
    expect(f.completions).toEqual([]);
    expect(() => f.tools.background!.query(f.session, task.id)).toThrow("Background task not found");
});
it("refreshes selectable tools on registration, replacement and disposal", async () => {
    const f = await fixture(false);
    const definition = {
        name: "extra_read",
        description: "Extra read",
        background: true,
        parameters: Schema.object({}),
        execute: async () => ({ status: "success" as const }),
    };
    const removeOld = f.tools.registerTool(definition);
    const names = () => f.tools.ctx.schema.get("toolService.backgroundEligibleTools")?.inner?.list?.map((choice: any) => choice.value) ?? [];
    expect(names()).toContain("extra_read");
    const rendered = f.tools.ctx.schema.get("toolService.backgroundEligibleTools");
    expect(rendered.type).toBe("array");
    expect(rendered.meta.role).toBe("checkbox");
    expect(rendered.meta.default).toEqual(["web_search", "fetch_webpage", "get_image_description"]);
    f.tools.registerTool({ ...definition, background: false });
    expect(names()).not.toContain("extra_read");
    const removeNew = f.tools.registerTool({ ...definition });
    removeOld();
    expect(names()).toContain("extra_read");
    removeNew();
    expect(names()).not.toContain("extra_read");
});

it("keeps other instances' tool choices when a shared schema owner stops", async () => {
    const f = await fixture(false);
    let other!: ToolService;
    const fork = f.tools.ctx.plugin((scope) => {
        other = new ToolService(scope, { backgroundTools: { enabled: false } } as any, { logging: loggingStub() } as any);
        scope.on("dispose", () => other.stop());
    });
    onTestFinished(() => fork.dispose());
    add(f, async () => ({ status: "success" }));
    other.registerTool({
        name: "other_read",
        description: "Other read",
        background: true,
        parameters: Schema.object({}),
        execute: async () => ({ status: "success" }),
    });
    const names = () => f.tools.ctx.schema.get("toolService.backgroundEligibleTools").inner!.list!.map((choice) => choice.value);
    expect(names()).toContain("other_read");
    expect(names()).toContain("read_slow");
    await fork.dispose();
    expect(names()).not.toContain("other_read");
    expect(names()).toContain("read_slow");
});
