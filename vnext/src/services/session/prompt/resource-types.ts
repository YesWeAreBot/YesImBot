export interface RoleFileSpec {
  filename: string;
  tag: "character" | "agents" | "tools" | "memory";
}

export interface ResourceLoaderConfig {
  soulDir: string;
}

export const ROLE_FILES: readonly RoleFileSpec[] = [
  { filename: "SOUL.md", tag: "character" },
  { filename: "AGENTS.md", tag: "agents" },
  { filename: "TOOLS.md", tag: "tools" },
  { filename: "MEMORY.md", tag: "memory" },
] as const;
