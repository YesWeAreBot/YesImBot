import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resourcesDir = resolve(__dirname, "../".repeat(
  __dirname.includes("dist") ? 1 : 2,
), "resources/templates");

export function loadTemplate(name: string): string {
  return readFileSync(resolve(resourcesDir, `${name}.mustache`), "utf-8");
}

export function loadPartial(name: string): string {
  return loadTemplate(`partials/${name}`);
}
