// Context types
export * from "./context";

// Tool types
export * from "./tool";

// Result types
export * from "./result";

// Schema type inference
export * from "./schema-types";

export interface PluginMetadata {
    name: string;
    display?: string;
    description: string;
    version?: string;
    author?: string;
    builtin?: boolean;
}
