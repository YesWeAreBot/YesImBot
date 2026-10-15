import { expect, it } from "vitest";

import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services } from "../src/shared/constants";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function fixture(build: () => Promise<any>, filter = async () => {}) {
    const ctx: any = { [Services.Logger]: { getLogger: () => ({}) }, parallel: filter };
    const memory = new SemanticMemoryManager(ctx, {} as any);
    const world = Object.create(WorldStateService.prototype);
    Object.assign(world, { ctx, l2_manager: memory, contextBuilder: { build } });
    return { world, memory, session: { platform: "onebot", channelId: "room" } as any };
}
for (const phase of ["read", "filter"]) {
    it(`rejects an automatic context cleared during ${phase}`, async () => {
        const entered = deferred(),
            release = deferred();
        const pause = async () => {
            entered.resolve();
            await release.promise;
        };
        const f = fixture(
            async () => {
                if (phase === "read") await pause();
                return { content: "deleted secret" };
            },
            phase === "filter" ? pause : undefined,
        );
        const building = f.world.buildWorldState(f.session);
        await entered.promise;
        await f.memory.clearHistory(f.session, async () => {});
        const rejected = expect(building).rejects.toThrow("历史已清除");
        release.resolve();
        await rejected;
    });
}
it("waits for an active deletion before reading an automatic context", async () => {
    const deleting = deferred(),
        release = deferred();
    let deleted = false;
    const f = fixture(async () => ({ content: deleted ? "fresh" : "deleted secret" }));
    const clearing = f.memory.clearHistory(f.session, async () => {
        deleting.resolve();
        await release.promise;
        deleted = true;
    });
    await deleting.promise;
    const building = f.world.buildWorldState(f.session);
    release.resolve();
    await clearing;
    expect(await building).toEqual({ content: "fresh" });
});
it("preserves a context when only another channel is cleared", async () => {
    const entered = deferred(),
        release = deferred();
    const f = fixture(async () => {
        entered.resolve();
        await release.promise;
        return { content: "retained" };
    });
    const building = f.world.buildWorldState(f.session);
    await entered.promise;
    await f.memory.clearHistory({ platform: "onebot", channelId: "other" }, async () => {});
    release.resolve();
    expect(await building).toEqual({ content: "retained" });
});
