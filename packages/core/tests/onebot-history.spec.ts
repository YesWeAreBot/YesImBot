import { afterEach, expect, it, vi } from "vitest";

import { OneBotHistoryBackfill } from "../src/world/onebot-history";

afterEach(() => vi.restoreAllMocks());

function message(id: number, content: string, extra: Record<string, unknown> = {}) {
    return {
        message_id: id,
        message_type: "group",
        group_id: 123,
        sender: { user_id: 73, nickname: "sender" },
        time: Math.floor(Date.now() / 1000),
        message: [{ type: "text", data: { text: content } }],
        ...extra,
    };
}

function setup() {
    let tick!: () => Promise<void>;
    let generation = 0;
    const snapshot = new Map<string, any>();
    const ctx = {
        on: vi.fn(() => () => {}),
        filter: () => true,
        setInterval: vi.fn((callback) => {
            tick = callback;
            return () => {};
        }),
        database: { get: async (_table: string, query: { id: { $in: string[] } }) => query.id.$in.flatMap((id) => snapshot.get(id) ?? []) },
        $commander: { inferCommand: vi.fn() },
    };
    const world = {
        isChannelAllowed: () => true,
        config: { ignoreSelfMessage: false },
        l2_manager: { waitForHistoryClear: async () => {}, getHistoryGeneration: () => generation },
        recordMessage: vi.fn(async (row, gen) => {
            if (gen !== generation) return "invalidated";
            snapshot.set(row.id, row);
            return "stored";
        }),
    };
    const get = vi.fn(async (_action: string, _params: object): Promise<unknown> => ({ messages: [] }));
    const manager = new OneBotHistoryBackfill(
        ctx as any,
        { enabled: true, intervalSeconds: 60 },
        world as any,
        { transform: async (value: string) => value } as any,
        { debug: vi.fn() } as any,
    );
    const session: any = {
        platform: "onebot",
        selfId: "100",
        isDirect: false,
        guildId: "123",
        channelId: "123",
        event: { channel: { id: "123" }, guild: { id: "123" } },
        bot: {
            status: 1,
            config: { advanced: {} },
            internal: { _get: get },
            session: ({ message }) => ({ platform: "onebot", content: message.content, stripped: { content: message.content, appel: false } }),
        },
    };
    manager.start();
    manager.observe(session);
    return {
        manager,
        session,
        get,
        snapshot,
        tick: () => tick(),
        clear: () => {
            generation++;
            snapshot.clear();
        },
    };
}

it("merges the recent OneBot page in the current target, keeps discovery distinct from authorship, and skips duplicates", async () => {
    const f = setup();
    f.get.mockResolvedValue({
        messages: [message(5, "other group", { group_id: 321 }), message(6, "hello"), message(7, "conf.set providers[0].apiKey secret")],
    });
    await f.tick();
    const result = await f.manager.refresh(f.session);
    expect(f.get).toHaveBeenCalledWith("get_group_msg_history", { group_id: 123, count: 30 });
    expect(result).toMatchObject({ fetched: 3, stored: 0, skipped: 3, failed: 0 });
    expect([...f.snapshot.values()]).toEqual([
        expect.objectContaining({ id: "6", content: "hello", sender: { id: "73", name: "sender", discovery: "onebot-periodic" } }),
    ]);
    f.manager.stop();
});

it("does not import own-account output that could have been excluded by live command privacy rules", async () => {
    const f = setup();
    f.get.mockResolvedValueOnce(message(9, "sensitive command output", { sender: { user_id: Number(f.session.selfId), nickname: "bot" } }));
    expect(await f.manager.refresh(f.session, "9")).toMatchObject({ stored: 0, skipped: 1 });
    expect(f.snapshot.size).toBe(0);
    f.manager.stop();
});

it("requires the keyed result to belong to the current chat and cannot restore a cleared history", async () => {
    const f = setup();
    f.get.mockResolvedValueOnce(message(9, "neighbor", { group_id: 321 }));
    expect(await f.manager.refresh(f.session, "9")).toMatchObject({ stored: 0, skipped: 1 });
    f.get.mockResolvedValueOnce(message(9, "here"));
    expect(await f.manager.refresh(f.session, "9")).toMatchObject({ stored: 1, messageIds: ["9"] });
    f.clear();
    f.get.mockResolvedValueOnce(message(9, "here"));
    expect(await f.manager.refresh(f.session, "9")).toMatchObject({ stored: 0, skipped: 1 });
    expect(f.snapshot.size).toBe(0);
    f.manager.stop();
});

it("uses bounded NapCat pagination and de-duplicates the overlapping boundary", async () => {
    const f = setup();
    f.get.mockResolvedValueOnce({
        messages: Array.from({ length: 30 }, (_, index) => message(30 - index, "newer", { message_seq: 30 - index })),
    });
    f.get.mockResolvedValueOnce({ messages: [message(1, "overlap"), message(100, "missing")] });
    expect(await f.manager.refresh(f.session)).toMatchObject({ fetched: 32, stored: 31, skipped: 1, failed: 0 });
    expect(f.get).toHaveBeenNthCalledWith(2, "get_group_msg_history", { group_id: 123, count: 30, message_seq: "1", reverseOrder: false });
    expect(f.snapshot.get("100")?.sender.discovery).toBe("onebot-tool");
    f.manager.stop();
});

it("drops a pending page when history is cleared during the adapter read", async () => {
    const f = setup();
    let finish!: (value: unknown) => void;
    f.get.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const pending = f.manager.refresh(f.session);
    await vi.waitFor(() => expect(f.get).toHaveBeenCalledOnce());
    f.clear();
    finish({ messages: [message(9, "old")] });
    await expect(pending).rejects.toThrow("补录期间会话授权或历史状态已改变");
    expect(f.snapshot.size).toBe(0);
    f.manager.stop();
});
