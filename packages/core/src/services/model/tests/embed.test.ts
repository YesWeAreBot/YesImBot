///<reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import { embed } from "@xsai/embed";

(async () => {
    console.log(process.env.API_KEY_SILICON);

    describe("@xsai/embed", () => {
        it("embed", async () => {
            const { embedding, usage } = await embed({
                baseURL: "https://api.siliconflow.cn/v1",
                input: "sunny day at the beach",
                model: "BAAI/bge-m3",
                apiKey: process.env.API_KEY_SILICON,
            });

            expect(embedding).toMatchSnapshot();
            expect(usage.prompt_tokens).toBe(6);
            expect(usage.total_tokens).toBe(6);
        });
    });
})();
