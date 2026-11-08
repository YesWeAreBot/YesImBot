// Type the host boundary without checking the console application's published
// TypeScript sources under this plugin's compiler options. Runtime imports still
// resolve to the real @koishijs/client supplied by the console.
export declare const store: {
    schema?: Record<string, import("./config-layout").FormSchema>;
};

export declare const Schema: {
    new (serialized: unknown): import("./config-layout").FormSchema;
};
