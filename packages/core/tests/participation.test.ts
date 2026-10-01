import assert from "node:assert/strict";
import { test } from "node:test";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";

const START = 1_000_000;
const CHAT = "onebot:bot:group";

function createManager(participation?: { enabled: boolean; durationSeconds: number; influence: number }) {
    const ctx = { on() {}, [Services.Logger]: { getLogger: () => ({ debug() {} }) } };
    const config = {
        participation,
        base: { text: 12 },
        attribute: { atMention: 25, isQuote: 15, isDirectMessage: 40 },
        interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 99, probabilityAmplifier: 1, replyCost: 35 },
    };
    return new WillingnessManager(ctx as any, config as any);
}

function session(overrides: Record<string, unknown> = {}) {
    return {
        cid: CHAT,
        userId: "alice",
        selfId: "bot",
        content: "hi",
        stripped: {},
        elements: [],
        isDirect: false,
        bot: { selfId: "bot" },
        resolve: (value: any) => value,
        ...overrides,
    } as any;
}

function at(id: string) {
    return [{ type: "at", attrs: { id } }];
}

function withClock(callback: (setNow: (now: number) => void) => void) {
    const original = Date.now;
    let now = START;
    Date.now = () => now;
    try {
        callback((value) => {
            now = value;
        });
    } finally {
        Date.now = original;
    }
}

function activeManager() {
    const manager = createManager({ enabled: true, durationSeconds: 60, influence: 0.5 });
    manager.handlePostReply(session(), CHAT);
    return manager;
}

test("participation is disabled when omitted or explicitly disabled", () => {
    withClock(() => {
        for (const options of [undefined, { enabled: false, durationSeconds: 60, influence: 0.5 }]) {
            const manager = createManager(options);
            manager.handlePostReply(session(), CHAT);
            manager.shouldReply(session(), CHAT);
            assert.equal(manager.getCurrentWillingness(CHAT), 12);
            assert.equal(manager.getParticipation(CHAT).active, false);
        }
    });
});

test("participation starts only after a successful reply and preserves the reply cost", () => {
    withClock(() => {
        const manager = createManager({ enabled: true, durationSeconds: 60, influence: 0.5 });
        manager.shouldReply(session(), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 12);
        assert.equal(manager.getParticipation(CHAT).active, false);
        manager.handlePreReply(CHAT);
        assert.equal(manager.getParticipation(CHAT).active, false);
        manager.handlePostReply(session(), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 0);
        assert.deepEqual(manager.getParticipation(CHAT), {
            active: true,
            lastReplyAt: START,
            expiresAt: START + 60_000,
            participantId: "alice",
        });
    });
});

test("a recent participant receives a decaying gain without extending expiry", () => {
    withClock((setNow) => {
        const manager = activeManager();
        manager.shouldReply(session(), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 18);
        assert.equal(manager.getParticipation(CHAT).expiresAt, START + 60_000);
        const midway = activeManager();
        setNow(START + 30_000);
        midway.shouldReply(session(), CHAT);
        assert.equal(midway.getCurrentWillingness(CHAT), 15);
        assert.equal(midway.getParticipation(CHAT).expiresAt, START + 60_000);
        const expired = activeManager();
        setNow(START + 90_000);
        expired.shouldReply(session(), CHAT);
        assert.equal(expired.getCurrentWillingness(CHAT), 12);
    });
});

test("participation expires at the boundary and queries never mutate stored state", () => {
    withClock(() => {
        const manager = activeManager();
        const snapshot = manager.getParticipation(CHAT, START);
        assert.equal(manager.getParticipation(CHAT, START + 60_000).active, false);
        assert.deepEqual(manager.getParticipation(CHAT, START), snapshot);
        snapshot.participantId = "changed";
        snapshot.expiresAt = 0;
        assert.equal(manager.getParticipation(CHAT, START).participantId, "alice");
        assert.equal(manager.getParticipation(CHAT, START).expiresAt, START + 60_000);
    });
});

test("only another successful reply refreshes the window and participant", () => {
    withClock((setNow) => {
        const manager = activeManager();
        setNow(START + 30_000);
        manager.handlePostReply(session({ userId: "bob" }), CHAT);
        assert.deepEqual(manager.getParticipation(CHAT), {
            active: true,
            lastReplyAt: START + 30_000,
            expiresAt: START + 90_000,
            participantId: "bob",
        });
    });
});

test("unrelated senders and groups without guildId do not receive participation gain", () => {
    withClock(() => {
        const manager = activeManager();
        manager.shouldReply(session({ userId: "bob", guildId: undefined }), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 12);
    });
});

test("explicit bot mentions and bot quotes invite other senders", () => {
    withClock(() => {
        const mentioned = activeManager();
        mentioned.shouldReply(session({ userId: "bob", elements: at("bot") }), CHAT);
        assert.equal(mentioned.getCurrentWillingness(CHAT), 55.5);
        const quoted = activeManager();
        quoted.shouldReply(session({ userId: "bob", quote: { user: { id: "bot" } } }), CHAT);
        assert.equal(quoted.getCurrentWillingness(CHAT), 40.5);
        const stripped = activeManager();
        stripped.shouldReply(session({ userId: "bob", stripped: { atSelf: true } }), CHAT);
        assert.equal(stripped.getCurrentWillingness(CHAT), 55.5);
    });
});

test("addressing other people suppresses the same-participant boost", () => {
    withClock(() => {
        const mentioned = activeManager();
        mentioned.shouldReply(session({ elements: at("bob") }), CHAT, ["text", "at"]);
        assert.equal(mentioned.getCurrentWillingness(CHAT), 37);
        const quoted = activeManager();
        quoted.shouldReply(session({ quote: { user: { id: "bob" } } }), CHAT, ["text", "quote"]);
        assert.equal(quoted.getCurrentWillingness(CHAT), 27);
    });
});

test("explicit bot invitation takes priority over other targets", () => {
    withClock(() => {
        const manager = activeManager();
        manager.shouldReply(session({ userId: "bob", elements: [...at("bot"), ...at("carol")] }), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 55.5);
    });
});

test("direct conversations use isDirect and receive participation gain", () => {
    withClock(() => {
        const manager = activeManager();
        manager.shouldReply(session({ userId: "bob", isDirect: true }), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 78);
    });
});

test("participation never creates a gain for blocked categories or forces a reply", () => {
    withClock(() => {
        const manager = activeManager();
        assert.deepEqual(manager.shouldReply(session({ elements: at("bot") }), CHAT, []), { decision: false, probability: 0 });
        assert.equal(manager.getCurrentWillingness(CHAT), 0);
        const textOnly = activeManager();
        textOnly.shouldReply(session({ userId: "bob", elements: at("bot"), isDirect: false }), CHAT, ["text"]);
        assert.equal(textOnly.getCurrentWillingness(CHAT), 12);
    });
});

test("assessment adjustment still multiplies only the current message gain", () => {
    withClock(() => {
        const manager = activeManager();
        manager.shouldReply(session(), CHAT, ["text"], 0.4);
        assert.equal(manager.getCurrentWillingness(CHAT), 7.2);
    });
});

test("chat and bot keys isolate participation; reset clears the window", () => {
    withClock(() => {
        const manager = activeManager();
        for (const key of ["onebot:bot:other-group", "onebot:other-bot:group", "other-platform:bot:group"]) {
            manager.shouldReply(session(), key);
            assert.equal(manager.getCurrentWillingness(key), 12);
            assert.equal(manager.getParticipation(key).active, false);
        }
        manager.reset(CHAT);
        assert.deepEqual(manager.getParticipation(CHAT), { active: false, lastReplyAt: null, expiresAt: null, participantId: null });
        manager.shouldReply(session(), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 12);
    });
});

test("missing sender IDs cannot match unrelated group messages", () => {
    withClock(() => {
        const manager = createManager({ enabled: true, durationSeconds: 60, influence: 0.5 });
        manager.handlePostReply(session({ userId: undefined }), CHAT);
        manager.shouldReply(session({ userId: undefined }), CHAT);
        assert.equal(manager.getCurrentWillingness(CHAT), 12);
        assert.equal(manager.getParticipation(CHAT).participantId, null);
    });
});

test("influence zero preserves ordinary gain and one bounds the multiplier to two", () => {
    withClock(() => {
        for (const [influence, expected] of [
            [0, 12],
            [1, 24],
        ]) {
            const manager = createManager({ enabled: true, durationSeconds: 60, influence });
            manager.handlePostReply(session(), CHAT);
            manager.shouldReply(session(), CHAT);
            assert.equal(manager.getCurrentWillingness(CHAT), expected);
        }
    });
});

test("out-of-range participation duration never creates an invalid date or gain", () => {
    withClock(() => {
        for (const durationSeconds of [1e13, 1e306, Infinity]) {
            const manager = createManager({ enabled: true, durationSeconds, influence: 0.5 });
            manager.handlePostReply(session(), CHAT);
            assert.equal(manager.getParticipation(CHAT).active, false);
            manager.shouldReply(session(), CHAT);
            assert.equal(manager.getCurrentWillingness(CHAT), 12);
        }
    });
});
