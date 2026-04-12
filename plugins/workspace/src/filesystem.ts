import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  countReplacements,
  createWorkspaceBoundaryError,
  normalizeWorkspacePath,
  toRelativeDisplayPath,
  withinBasePath,
} from "./helpers";
import type {
  EditFileInput,
  FileType,
  GrepInput,
  LocalFilesystemOptions,
  PathTypeEntry,
} from "./types";

export class LocalFilesystem {
  readonly basePath: string;
  readonly readOnly: boolean;
  readonly externalPaths: string[];

  constructor(options: LocalFilesystemOptions) {
    this.basePath = resolve(options.basePath);
    this.readOnly = options.readOnly ?? false;
    const rawExternalPaths = Array.isArray(options.externalPath)
      ? options.externalPath
      : options.externalPath
        ? [options.externalPath]
        : [];
    this.externalPaths = rawExternalPaths.map((path) =>
      isAbsolute(path) ? resolve(path) : resolve(this.basePath, path),
    );
  }

  async init(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
  }

  resolvePath(path: string): string {
    const candidates = isAbsolute(path)
      ? [resolve(path), resolve(this.basePath, normalizeWorkspacePath(path))]
      : [resolve(this.basePath, normalizeWorkspacePath(path))];

    for (const candidatePath of candidates) {
      if (withinBasePath(candidatePath, this.basePath)) {
        return candidatePath;
      }

      for (const externalPath of this.externalPaths) {
        if (withinBasePath(candidatePath, externalPath)) {
          return candidatePath;
        }
      }
    }

    throw createWorkspaceBoundaryError(path);
  }

  private ensureWritable(): void {
    if (this.readOnly) {
      throw new Error("Filesystem is read-only");
    }
  }

  async readFile(path: string): Promise<string> {
    const absolutePath = this.resolvePath(path);
    return readFile(absolutePath, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.ensureWritable();
    const absolutePath = this.resolvePath(path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  async editFile(input: EditFileInput): Promise<{ replaced: number }> {
    this.ensureWritable();
    const absolutePath = this.resolvePath(input.path);
    const content = await readFile(absolutePath, "utf8");
    const replaced = input.replaceAll
      ? countReplacements(content, input.oldText)
      : content.includes(input.oldText)
        ? 1
        : 0;

    const nextContent = input.replaceAll
      ? content.split(input.oldText).join(input.newText)
      : content.replace(input.oldText, input.newText);

    await writeFile(absolutePath, nextContent, "utf8");
    return { replaced };
  }

  async listFiles(
    path: string = "/",
    recursive = false,
    maxDepth = Number.POSITIVE_INFINITY,
  ): Promise<PathTypeEntry[]> {
    const rootPath = this.resolvePath(path);
    const entries: PathTypeEntry[] = [];

    const walk = async (currentPath: string, currentDepth: number): Promise<void> => {
      const children = await readdir(currentPath, { withFileTypes: true });
      for (const child of children) {
        const childPath = join(currentPath, child.name);
        const type: FileType = child.isDirectory() ? "directory" : "file";
        entries.push({
          path: toRelativeDisplayPath(this.basePath, childPath),
          type,
        });

        if (recursive && type === "directory" && currentDepth < maxDepth) {
          await walk(childPath, currentDepth + 1);
        }
      }
    };

    await walk(rootPath, 1);
    return entries;
  }

  async delete(path: string, recursive = false): Promise<void> {
    this.ensureWritable();
    const absolutePath = this.resolvePath(path);
    await rm(absolutePath, { recursive, force: false });
  }

  async fileStat(
    path: string,
  ): Promise<{ path: string; type: FileType; size: number; modifiedAt: Date }> {
    const absolutePath = this.resolvePath(path);
    const fileStat = await stat(absolutePath);
    return {
      path: toRelativeDisplayPath(this.basePath, absolutePath),
      type: fileStat.isDirectory() ? "directory" : "file",
      size: fileStat.size,
      modifiedAt: fileStat.mtime,
    };
  }

  async mkdir(path: string): Promise<void> {
    this.ensureWritable();
    const absolutePath = this.resolvePath(path);
    await mkdir(absolutePath, { recursive: true });
  }

  async grep(input: GrepInput): Promise<Array<{ path: string; line: number; content: string }>> {
    const rootPath = this.resolvePath(input.path ?? "/");
    const flags = input.caseSensitive ? "g" : "gi";
    const regex = new RegExp(input.pattern, flags);
    const maxResults = input.maxResults ?? 50;
    const matches: Array<{ path: string; line: number; content: string }> = [];

    const walk = async (currentPath: string): Promise<void> => {
      if (matches.length >= maxResults) {
        return;
      }

      const currentStat = await stat(currentPath);
      if (currentStat.isDirectory()) {
        const children = await readdir(currentPath, { withFileTypes: true });
        for (const child of children) {
          await walk(join(currentPath, child.name));
          if (matches.length >= maxResults) {
            return;
          }
        }
        return;
      }

      const content = await readFile(currentPath, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        regex.lastIndex = 0;
        if (regex.test(line)) {
          matches.push({
            path: toRelativeDisplayPath(this.basePath, currentPath),
            line: index + 1,
            content: line,
          });
          if (matches.length >= maxResults) {
            return;
          }
        }
      }
    };

    await walk(rootPath);
    return matches;
  }
}
