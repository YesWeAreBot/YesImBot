import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { DEFAULT_PERSONA_MD } from "./default-persona.js";

/**
 * Ensure a PERSONA.md file exists at the given path.
 * - If missing: creates it with the built-in Athena persona and returns the content.
 * - If present: reads and returns the existing content.
 */
export async function ensurePersonaFile(path: string): Promise<string> {
  if (existsSync(path)) {
    return readFile(path, "utf-8");
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, DEFAULT_PERSONA_MD, "utf-8");
  return DEFAULT_PERSONA_MD;
}
