import { normalize, sep } from "node:path";

export function createWorkspaceBoundaryError(path: string): Error {
  return new Error(`Path '${path}' is outside workspace base path`);
}

export function withinBasePath(targetPath: string, basePath: string): boolean {
  if (targetPath === basePath) {
    return true;
  }

  const rootedBasePath = basePath.endsWith(sep) ? basePath : `${basePath}${sep}`;
  return targetPath.startsWith(rootedBasePath);
}

export function normalizeWorkspacePath(path: string): string {
  const normalized = normalize(path.replace(/\\/g, "/"));
  return normalized.replace(/^\/+/, "");
}

export function countReplacements(content: string, search: string): number {
  if (!search) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= content.length) {
    const next = content.indexOf(search, index);
    if (next === -1) {
      break;
    }
    count += 1;
    index = next + search.length;
  }
  return count;
}

export function toRelativeDisplayPath(basePath: string, absolutePath: string): string {
  const relativePath = absolutePath.startsWith(basePath)
    ? absolutePath.slice(basePath.length).replace(/^\/+/, "")
    : absolutePath;
  return relativePath ? `/${relativePath.replace(/\\/g, "/")}` : "/";
}
