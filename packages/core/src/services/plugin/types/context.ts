import type { Session } from "koishi";
import type { AnyStimulus, WorldState } from "@/services/world/types";

/**
 * Context provided to tools when they are invoked.
 */
export interface ToolContext {
    /** Access to the current session */
    readonly session?: Session;

    /** The stimulus that triggered the tool invocation */
    readonly stimulus?: AnyStimulus;

    /** The constructed world state at the time of invocation */
    readonly worldState?: WorldState;

    /** Additional metadata for the tool invocation */
    metadata?: Record<string, any>;
}
