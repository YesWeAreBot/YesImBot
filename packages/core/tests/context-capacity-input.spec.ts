import { Schema } from "koishi";
import { expect, it } from "vitest";

import { ModelConfigSchema } from "../src/model/config";
import { parseContextLimit } from "../src/model/context-limit";

function capacityTable(schema = ModelConfigSchema) {
    const custom = schema.dict!.contextLimit.list![1].list!.find((branch) => branch.dict?.mode.value === "custom")!;
    return custom.dict!.value.list?.find((branch) => branch.type === "array");
}
it("renders a native fixed-length table with exactly number and unit data columns", () => {
    const schema = new Schema(JSON.parse(JSON.stringify(ModelConfigSchema)));
    const table = capacityTable(schema);
    expect(table?.meta.role).toBe("table");
    expect(table?.meta.min).toBe(1);
    expect(table?.meta.max).toBe(1);
    expect(Object.keys(table?.inner?.dict ?? {})).toEqual(["amount", "unit"]);
    expect(table?.inner?.dict?.amount.type).toBe("number");
    expect(table?.inner?.dict?.unit.list?.map((choice) => choice.value)).toEqual(["token", "K", "M"]);
});
it.each([
    [1.5, "M", 1500000],
    [128, "K", 128000],
    [131072.5, "token", 131072.5],
    [1e-7, "M", 0.1],
])("converts a table capacity %s %s to tokens", (amount, unit, expected) => {
    const schema = new Schema(JSON.parse(JSON.stringify(ModelConfigSchema)));
    const config = schema({ modelId: "m", contextLimit: { mode: "custom", value: [{ amount, unit }] } });
    expect(parseContextLimit(config.contextLimit.value)).toBeCloseTo(expected, 12);
});
it.each(["128K", "1m", " .5 k ", "131072.5"])("loads the legacy declaration %s into the table", (value) => {
    const schema = new Schema(JSON.parse(JSON.stringify(ModelConfigSchema)));
    const config = schema({ modelId: "m", contextLimit: { mode: "custom", value } });
    expect(Array.isArray(config.contextLimit.value)).toBe(true);
    expect(parseContextLimit(config.contextLimit.value)).toBe(parseContextLimit(value));
});
it.for([
    [],
    [
        { amount: 1, unit: "K" },
        { amount: 2, unit: "M" },
    ],
    [{ amount: 0, unit: "K" }],
    [{ amount: -1, unit: "M" }],
    [{ amount: NaN, unit: "K" }],
    [{ amount: Infinity, unit: "token" }],
    [{ amount: 1, unit: "G" }],
    [{ amount: 1e13, unit: "M" }],
])("rejects an invalid table declaration %j", (value) => {
    expect(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value } })).toThrow(/./);
});

it.each(["9007199254740991.1", "9007199254740.9911K"])("rejects unsafe legacy capacity %s before numeric rounding", (value) => {
    expect(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value } })).toThrow(/./);
});

it("offers an editable initial row without accepting a missing custom capacity", () => {
    const table = capacityTable();
    expect(table?.meta.default).toEqual([{ unit: "K" }]);
    expect(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom" } })).toThrow(/./);
    expect(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value: [{ unit: "K" }] } })).toThrow(/./);
});

it("keeps the capacity title on its outer fold without inheriting it into native inner headers", () => {
    const schema = new Schema(JSON.parse(JSON.stringify(ModelConfigSchema))).dict!.contextLimit;
    expect(schema.meta.description).toContain("上下文容量");
    expect(schema.meta.collapse).toBe(true);
    for (const child of schema.list!.filter((item) => !item.meta.hidden)) {
        // Native intersect merges parent metadata into children rendered without a fold.
        const renderedMeta = { ...schema.meta, ...child.meta };
        expect(renderedMeta.description).toBe("");
    }
    expect(capacityTable()?.inner?.dict?.amount.type).toBe("number");
});
