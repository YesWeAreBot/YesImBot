import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DecisionJournal } from "../src/agent/decision-journal";
import { DecisionRecords } from "../src/agent/decision-record";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";

it("replays recorded live calculations across nonlinear gain and participation without exposing text", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "yib-live-replay-"));
    const journal = new DecisionJournal(dir, { maxEntries: 100, maxBytes: 1048576, retentionHours: 24 });
    const records = new DecisionRecords(100, Date.now, (r) => {
        void journal.append(r);
    });
    const manager = new WillingnessManager(
        { on() {}, [Services.Logger]: { getLogger: () => ({ debug() {} }) } } as any,
        {
            participation: { enabled: true, durationSeconds: 60, influence: 0.5 },
            base: { text: 12 },
            attribute: { atMention: 30, isQuote: 15, isDirectMessage: 40 },
            interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1.2 },
            lifecycle: { maxWillingness: 100, probabilityThreshold: 25, probabilityAmplifier: 0.04, replyCost: 35 },
        } as any,
    );
    const target = { platform: "qq", selfId: "bot", channelId: "g", isDirect: false };
    const session: any = {
        ...target,
        cid: "qq:g",
        userId: "u",
        content: "private-prompt-marker",
        stripped: {},
        elements: [],
        bot: { selfId: "bot" },
        resolve: (v: any) => v,
    };
    try {
        for (let index = 0; index < 4; index++) {
            const key = JSON.stringify(["qq", "bot", "g"]);
            if (index === 1) manager.handlePostReply(session, key);
            if (index === 2) session.elements = [{ type: "at", attrs: { id: "bot" } }];
            const id = records.begin(target, "user_message");
            const result = manager.shouldReply(session, key, undefined, 1.33);
            records.update(id, { stage: "calculated", ...result });
            records.update(id, { stage: "completed", success: false });
        }
        await journal.close();
        expect(await readFile(journal.filePath, "utf8")).not.toContain("private-prompt-marker");
        const replay = spawnSync("node", [path.resolve(import.meta.dir, "../scripts/replay-decisions.cjs"), journal.filePath], {
            encoding: "utf8",
        });
        expect(replay.status).toBe(0);
        const lines = replay.stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(lines.at(-1).summary.replayed).toBe(4);
        expect(lines.at(-1).summary.mismatches).toBe(0);
        expect(lines.filter((line) => line.status === "replayed").every((line) => line.matches)).toBe(true);
    } finally {
        await journal.close();
        await rm(dir, { recursive: true, force: true });
    }
});
