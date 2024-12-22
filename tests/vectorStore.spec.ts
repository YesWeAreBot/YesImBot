import { describe, it } from "@jest/globals";
import assert from "assert";
import { readFileSync } from "fs";
import { Context } from "koishi";
import path from "path";

import { Memory } from "../src/memory/memory";
import { isEmpty } from "../src/utils/string";

globalThis.logger = console;

const memory = new Memory(
  new Context(),
  {
    APIType: "Ollama",
    BaseURL: "http://localhost:11434",
    AIModel: "deepseek-coder-v2:latest",
    APIKey: "",
  },
  {
    APIType: "Ollama",
    BaseURL: "http://localhost:11434",
    EmbeddingModel: "nomic-embed-text",
  }
);

describe("vectorStore", () => {
  it("addMessage", async () => {
    const tasks: (() => Promise<any>)[] = [];
    readFileSync(path.join(__dirname, "../data/cache/article.txt"), "utf-8")
      .split(/[\n\.\。\；]/)
      .filter((line) => !isEmpty(line))
      .forEach(async (line) => {
        tasks.push(() => memory.addText(line.trim()));
      });

    console.log(`tasks length: ${tasks.length}`);

    await parallelLimit(tasks, 16);

    console.time("getSimilarMessages");
    const data = await memory.search("what fruit is my favorite", 3);
    console.timeEnd("getSimilarMessages");
    console.log(data);

    assert.deepEqual(data, [
      "My favorite fruit is apple",
      "I like apple",
      "I like orange",
    ]);
  });
});

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const queue: (() => Promise<T>)[] = [...tasks]; // 任务队列

  async function runTask(task: () => Promise<T>) {
    const result = await task();
    results.push(result);
  }

  const workers = Array.from({ length: limit }, () =>
    (async () => {
      while (queue.length > 0) {
        const task = queue.shift(); // 从队列中取出任务
        if (task) await runTask(task);
      }
    })()
  );

  await Promise.all(workers); // 等待所有任务完成
  return results;
}
