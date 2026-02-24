import { vi } from "vitest";

// Mock koishi Schema for unit tests that import willingness.ts
// Schema is only used for config declaration, not runtime logic
function createSchemaChain() {
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
      return (..._args: unknown[]) => new Proxy(chain, handler);
    },
  };
  return new Proxy(chain, handler);
}

const SchemaMock = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === "intersect" || prop === "object" || prop === "array") {
        return (..._args: unknown[]) => createSchemaChain();
      }
      if (prop === "number" || prop === "string" || prop === "boolean") {
        return () => createSchemaChain();
      }
      if (prop === "dynamic") {
        return () => createSchemaChain();
      }
      return (..._args: unknown[]) => createSchemaChain();
    },
  },
);

vi.mock("koishi", () => ({
  Schema: SchemaMock,
  Context: class {},
  Service: class {},
  Random: { id: () => "mock-id" },
}));
