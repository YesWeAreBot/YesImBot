export * from "./context";
export * from "./hooks";
export * from "./result";
export * from "./schema-types";
export * from "./tool";

export interface PluginMetadata {
    name: string;
    display?: string;
    description: string;
    version?: string;
    author?: string;
    builtin?: boolean;
}
