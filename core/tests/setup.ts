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

const hMock = Object.assign(
  (tag: string, attrs?: Record<string, unknown>) => ({
    toString: () => {
      const attrText = Object.entries(attrs ?? {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => ` ${key}="${String(value)}"`)
        .join("");
      return `<${tag}${attrText}/>`;
    },
  }),
  {
    parse: (text: string) => {
      const matches = [...text.matchAll(/<img\s+id="([^"]+)"(?:\s+status="([^"]+)")?\s*\/>/g)];
      return matches.map((match) => ({
        type: "img",
        attrs: {
          id: match[1],
          ...(match[2] ? { status: match[2] } : {}),
        },
        toString: () => match[0],
      }));
    },
  },
);

vi.mock("koishi", () => ({
  Schema: SchemaMock,
  Context: class {},
  Service: class {
    ctx: Record<string, unknown>;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>) {
      this.ctx = ctx;
      this.logger = (ctx.logger as ((name: string) => Record<string, unknown>) | undefined)?.(
        "service",
      ) ?? {
        info: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        error: () => undefined,
      };
    }
  },
  Random: { id: () => "mock-id" },
  h: hMock,
  sleep: async () => undefined,
}));
