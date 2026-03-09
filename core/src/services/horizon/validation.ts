import type { Logger } from "koishi";

import type { Environment, HorizonView } from "./types";

/** Default environment used when buildView cannot determine channel context */
function defaultEnvironment(): Environment {
  return {
    type: "unknown",
    id: "",
    name: "",
    platform: "unknown",
    channelId: "",
  };
}

/**
 * Validates a potentially-partial HorizonView and fills safe defaults for any
 * missing required fields. Never throws — logs warnings via the provided logger.
 */
export function validateAndFixHorizonView(
  view: Partial<HorizonView>,
  logger?: Logger,
): HorizonView {
  const fixed: string[] = [];

  if (!view.self) {
    fixed.push("self");
    view.self = { id: "", name: "" };
  }

  if (!view.environment) {
    fixed.push("environment");
    view.environment = defaultEnvironment();
  }

  if (!Array.isArray(view.entities)) {
    fixed.push("entities");
    view.entities = [];
  }

  if (!Array.isArray(view.history)) {
    fixed.push("history");
    view.history = [];
  }

  if (fixed.length > 0 && logger) {
    logger.warn("HorizonView validation fixed missing fields: %s", fixed.join(", "));
  }

  return view as HorizonView;
}
