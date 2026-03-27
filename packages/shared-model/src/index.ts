import type {} from "koishi";

import { ModelRegistry } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.model": ModelRegistry;
  }
}

export * from "./types";
