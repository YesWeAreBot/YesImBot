import { Schema } from "koishi";
import { expect, it } from "vitest";

import { toolJSONSchema } from "../src/extension/json-schema";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";
it("describes nested composite constraints without dropping input transforms", () => {
    const input = Schema.intersect([
        Schema.object({ mode: Schema.union([Schema.const("a"), Schema.const("b")]).required() }),
        Schema.object({
            count: Schema.number().min(2).max(8).step(2),
            items: Schema.array(Schema.string().min(1).max(4)).min(1).max(3),
            parsed: Schema.transform(Schema.string().description("JSON input"), JSON.parse),
        }),
    ]);
    const json: any = toolJSONSchema(input);
    expect(json.allOf[1].properties.count).toMatchObject({ type: "number", minimum: 2, maximum: 8, multipleOf: 2 });
    expect(json.allOf[1].properties.items).toMatchObject({ minItems: 1, maxItems: 3, items: { minLength: 1, maxLength: 4 } });
    expect(json.allOf[1].properties.parsed).toMatchObject({ type: "string", description: "JSON input" });
    const tools = new ToolService({} as any, {} as any, { logging: loggingStub(), world: {} } as any);
    tools.registerTool({ name: "composite", description: "test", parameters: input, execute: async () => ({ status: "success" }) });
    expect((tools.getSchema("composite") as any).parametersJSONSchema).toEqual(json);
});
it("keeps offset steps exact when a numeric step is relative to a nonzero minimum", () => {
    expect(toolJSONSchema(Schema.number().min(1).step(2))).toMatchObject({ minimum: 1, "x-step": 2, "x-step-base": 1 });
    expect(toolJSONSchema(Schema.number().min(1).step(2))).not.toHaveProperty("multipleOf");
});
