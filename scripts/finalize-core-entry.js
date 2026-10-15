import { access, writeFile } from "node:fs/promises";

// Both module systems must use one implementation, including its async scopes.
const entry = new URL("../packages/core/lib/index.cjs", import.meta.url);
await access(entry);
await writeFile(
    new URL("../packages/core/lib/index.mjs", import.meta.url),
    'export * from "./index.cjs";\nimport core from "./index.cjs";\nexport default core.default;\n',
);
