import { resolve } from "path";
import { Context } from "koishi";
import {} from "@koishijs/plugin-console";
import { Metadata } from "koishi-plugin-yesimbot-memory";
import { Config } from "./config";

export const name = "yesimbot-webui";

export const inject = {
  required: ["database", "console", "memory"],
};

export { Config } from "./config";

declare module "@koishijs/plugin-console" {
  interface Events {
    "memory/getAll": () => Metadata[];
    "memory/addText": (content: string, tags: string[]) => Promise<string>;
    "memory/delete": (id: string) => void;
    "memory/update": (id: string, data: any) => void;
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.inject(["console"], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, "../client/index.ts"),
      prod: resolve(__dirname, "../dist"),
    });
  });

  // 提供后端 API
  ctx.console.addListener("memory/getAll", () => {
    ctx.logger.info("memory/getAll");
    return ctx.memory.getAll();
  });

  ctx.console.addListener("memory/addText", (content: string, tags: string[]) => {
      ctx.logger.info("memory/addText");
      return ctx.memory.addText(content);
    }
  );

  ctx.console.addListener("memory/delete", (id: string) => {
    ctx.logger.info("memory/delete");
    return ctx.memory.delete(id);
  });

  ctx.console.addListener("memory/update", (id: string, data: any) => {
    ctx.logger.info("memory/update");
    return ctx.memory.update(id, data);
  });
}
