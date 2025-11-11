import { Schema } from "koishi";

/**
 * Extract TypeScript type from Koishi Schema.
 * This is a best-effort type extraction utility.
 */
export type InferSchemaType<T> = T extends Schema<infer U> ? U : never;
