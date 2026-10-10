import { expect, it } from "bun:test";
import { StreamParser } from "../src/shared/utils/stream-parser";

const schema = {
    thoughts: { observe: "string", analyze_infer: "string", plan: "string" },
    actions: [{ function: "string", params: "any" }],
    request_heartbeat: "boolean",
};

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const value of stream) values.push(value);
    return values;
}

it("waits for an object after thoughts is repaired to null in an incomplete chunk", async () => {
    const parser = new StreamParser(schema);
    const thoughts = collect(parser.stream("thoughts"));
    const actions = collect(parser.stream("actions"));
    const heartbeat = collect(parser.stream("request_heartbeat"));

    expect(() => parser.processText('{"thoughts":', false)).not.toThrow();
    parser.processText('{"thoughts":{"observe":"seen","analyze_infer":"reason', false);
    parser.processText('{"thoughts":{"observe":"seen","analyze_infer":"reason', false);
    parser.processText(JSON.stringify({
        thoughts: { observe: "seen", analyze_infer: "reason", plan: "respond" },
        actions: [{ function: "send_message", params: { message: "reply" } }],
        request_heartbeat: false,
    }), true);

    expect(await thoughts).toEqual([{ observe: "seen" }, { analyze_infer: "reason" }, { plan: "respond" }]);
    expect(await actions).toEqual([{ function: "send_message", params: { message: "reply" } }]);
    expect(await heartbeat).toEqual([false]);
});

it("closes every stream safely when finalized thoughts and actions are null", async () => {
    const parser = new StreamParser(schema);
    const thoughts = collect(parser.stream("thoughts"));
    const actions = collect(parser.stream("actions"));
    const heartbeat = collect(parser.stream("request_heartbeat"));

    expect(() => parser.processText('{"thoughts":null,"actions":null,"request_heartbeat":false}', true)).not.toThrow();
    expect(await thoughts).toEqual([]);
    expect(await actions).toEqual([]);
    expect(await heartbeat).toEqual([false]);
});

for (const invalid of [null, "not an array", { function: "send_message" }]) {
    it(`waits for valid actions after an intermediate ${JSON.stringify(invalid)}`, async () => {
        const parser = new StreamParser(schema);
        const actions = collect(parser.stream("actions"));
        const heartbeat = collect(parser.stream("request_heartbeat"));

        parser.processText(JSON.stringify({ actions: invalid, request_heartbeat: false }), false);
        parser.processText(JSON.stringify({
            actions: [{ function: "first", params: {} }, { function: "second", params: {} }],
            request_heartbeat: true,
        }), true);

        expect(await actions).toEqual([{ function: "first", params: {} }, { function: "second", params: {} }]);
        expect(await heartbeat).toEqual([true]);
    });
}

for (const invalid of [null, "not an object", 1, false, []]) {
    it(`keeps thoughts open after an intermediate ${JSON.stringify(invalid)} even when the next key appears`, async () => {
        const parser = new StreamParser(schema);
        const thoughts = collect(parser.stream("thoughts"));

        parser.processText(JSON.stringify({ thoughts: invalid, actions: [] }), false);
        parser.processText(JSON.stringify({
            thoughts: { observe: "seen", analyze_infer: "reason", plan: "respond" },
            actions: [],
        }), true);

        expect(await thoughts).toEqual([{ observe: "seen" }, { analyze_infer: "reason" }, { plan: "respond" }]);
    });
}

it("flushes split valid objects, actions and heartbeat exactly once through process", async () => {
    const parser = new StreamParser(schema);
    const thoughts = collect(parser.stream("thoughts"));
    const actions = collect(parser.stream("actions"));
    const heartbeat = collect(parser.stream("request_heartbeat"));
    async function* chunks() {
        yield '{"thoughts":';
        yield '{"observe":"seen","analyze_infer":"reason","plan":"respond"},"actions":';
        yield '[{"function":"first","params":{}},';
        yield '{"function":"second","params":{}}],"request_heartbeat":true}';
    }

    await parser.process(chunks());
    expect(await thoughts).toEqual([{ observe: "seen" }, { analyze_infer: "reason" }, { plan: "respond" }]);
    expect(await actions).toEqual([{ function: "first", params: {} }, { function: "second", params: {} }]);
    expect(await heartbeat).toEqual([true]);
});

it("safely closes a stream whose input ends before the thoughts object arrives", async () => {
    const parser = new StreamParser(schema);
    const thoughts = collect(parser.stream("thoughts"));
    const actions = collect(parser.stream("actions"));
    const heartbeat = collect(parser.stream("request_heartbeat"));

    parser.processText('{"thoughts":', false);
    expect(() => parser.processText("", true)).not.toThrow();
    expect(await thoughts).toEqual([]);
    expect(await actions).toEqual([]);
    expect(await heartbeat).toEqual([]);
});
