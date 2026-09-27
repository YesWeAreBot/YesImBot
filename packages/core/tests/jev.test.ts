/* eslint-disable test/no-import-node-test -- test:jev 脚本使用 node --test 运行本文件 */
import type { JevConnection } from "../src/agent/jev";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSystemOne, noulConfidence } from "../src/agent/jev";

/**
 * Jev 通用客户端（agent/jev.ts）单测：三种原语解析、超时/中止容错、fail-open 语义。
 */

const conn: JevConnection = { apiKey: "test-key", baseURL: "https://api.typesafe.ai/v1/", model: "jev-test", timeoutMs: 1000 };

function httpMock(impl: (url: string, body: any, opts: any) => any): any {
    return { http: { post: impl } };
}

describe("noulConfidence", () => {
    it("0.5（完全不确定）伪置信度为 0", () => {
        assert.equal(noulConfidence(0.5), 0);
    });

    it("两端（0 / 1）伪置信度为 1", () => {
        assert.equal(noulConfidence(0), 1);
        assert.equal(noulConfidence(1), 1);
    });

    it("随距 0.5 的距离线性增长", () => {
        assert.ok(Math.abs(noulConfidence(0.25) - 0.5) < 1e-9);
        assert.ok(Math.abs(noulConfidence(0.75) - 0.5) < 1e-9);
    });
});

describe("evaluateSystemOne", () => {
    it("解析三种原语答案并透传 model，规范化 baseURL", async () => {
        const calls: Array<{ url: string; body: any; opts: any }> = [];
        const ctx = httpMock((url, body, opts) => {
            calls.push({ url, body, opts });
            return {
                model: "jev-returned",
                answers: {
                    q1: { type: "noul", noul: 0.7 },
                    q2: { type: "choice", choice: "yes", confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 } },
                    q3: { type: "score", score: 3, confidence: 0.8, legend: { 1: "low", 5: "high" } },
                },
            };
        });

        const result = await evaluateSystemOne(ctx, conn, { conversation: [] }, {
            q1: { type: "noul", instructions: "是否成立？" },
            q2: { type: "choice", instructions: "选一个", criteria: { yes: "是", no: "否" } },
            q3: { type: "score", instructions: "打分", criteria: ["低", "中", "高"] },
        });

        assert.ok(result);
        assert.equal(result.model, "jev-returned");
        assert.equal(result.answers.q1.type, "noul");
        assert.equal((result.answers.q1 as { noul: number }).noul, 0.7);
        assert.equal((result.answers.q2 as { choice: string }).choice, "yes");
        assert.equal((result.answers.q2 as { confidence: number }).confidence, 0.9);
        assert.equal((result.answers.q3 as { score: number }).score, 3);
        assert.equal((result.answers.q3 as { confidence: number }).confidence, 0.8);

        // 尾部斜杠被规范化；请求携带 model 与鉴权头
        assert.ok(calls[0].url.endsWith("/systemone"));
        assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
        assert.equal(calls[0].body.model, "jev-test");
        assert.equal(calls[0].opts.headers.Authorization, "Bearer test-key");
    });

    it("答案类型与问题不符时丢弃该问题，不整体失败", async () => {
        const ctx = httpMock(() => ({ answers: { q1: { type: "choice", choice: "x", confidence: 1 } } }));
        const result = await evaluateSystemOne(ctx, conn, {}, { q1: { type: "noul", instructions: "?" } });
        assert.ok(result);
        assert.equal(result.answers.q1, undefined);
    });

    it("noul 越界或非数值时丢弃", async () => {
        const ctx = httpMock(() => ({ answers: { q1: { type: "noul", noul: 1.5 } } }));
        const result = await evaluateSystemOne(ctx, conn, {}, { q1: { type: "noul", instructions: "?" } });
        assert.ok(result);
        assert.equal(result.answers.q1, undefined);
    });

    it("响应不可用（网络错误）返回 null", async () => {
        const ctx = httpMock(() => {
            throw new Error("network down");
        });
        const result = await evaluateSystemOne(ctx, conn, {}, { q1: { type: "noul", instructions: "?" } });
        assert.equal(result, null);
    });

    it("响应无 answers 字段返回 null", async () => {
        const ctx = httpMock(() => ({ model: "x" }));
        const result = await evaluateSystemOne(ctx, conn, {}, { q1: { type: "noul", instructions: "?" } });
        assert.equal(result, null);
    });

    it("apiKey 为空时直接返回 null", async () => {
        const ctx = httpMock(() => ({ answers: {} }));
        const result = await evaluateSystemOne(ctx, { ...conn, apiKey: "   " }, {}, {});
        assert.equal(result, null);
    });

    it("外部信号中止时返回 null", async () => {
        const controller = new AbortController();
        const ctx = httpMock(() => {
            controller.abort();
            throw new Error("aborted");
        });
        const result = await evaluateSystemOne(ctx, conn, {}, {}, controller.signal);
        assert.equal(result, null);
    });
});
