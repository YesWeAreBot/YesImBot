import type {} from "@koishijs/core";

import type { ModelRegistry } from "./types";

declare module "@koishijs/core" {
  interface Context {
    "yesimbot.model": ModelRegistry;
  }
}

export * from "@ai-sdk/provider-utils";
export * from "ai";
export * from "./types";
