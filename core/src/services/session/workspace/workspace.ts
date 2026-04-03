import { jsonSchema } from "@ai-sdk/provider-utils";

import { LocalFilesystem } from "./filesystem";
import { LocalSandbox } from "./sandbox";
import type {
  DeleteInput,
  EditFileInput,
  ExecuteCommandInput,
  FileStatInput,
  FileType,
  GrepInput,
  ListFilesInput,
  MkdirInput,
  PathTypeEntry,
  ReadFileInput,
  WorkspaceOptions,
  WorkspaceToolSet,
  WriteFileInput,
} from "./types";

export class Workspace {
  readonly filesystem?: LocalFilesystem;
  readonly sandbox?: LocalSandbox;

  constructor(options: WorkspaceOptions) {
    this.filesystem = options.filesystem;
    this.sandbox = options.sandbox;
  }

  async init(): Promise<void> {
    await this.filesystem?.init();
    await this.sandbox?.init();
  }

  getAgentTools(): WorkspaceToolSet {
    return this.createAgentTools();
  }

  createAgentTools(): WorkspaceToolSet {
    const tools: WorkspaceToolSet = {};
    this.registerFilesystemTools(tools);
    this.registerSandboxTools(tools);
    return tools;
  }

  private registerFilesystemTools(tools: WorkspaceToolSet): void {
    if (!this.filesystem) {
      return;
    }

    tools.read_file = {
      description: "Read file contents from workspace.",
      inputSchema: jsonSchema<ReadFileInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
        },
        required: ["path"],
      }),
      execute: this.executeReadFile.bind(this),
    };

    tools.list_files = {
      description: "List files and directories in workspace.",
      inputSchema: jsonSchema<ListFilesInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
          maxDepth: { type: "number" },
        },
      }),
      execute: this.executeListFiles.bind(this),
    };

    tools.file_stat = {
      description: "Get file or directory metadata.",
      inputSchema: jsonSchema<FileStatInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      }),
      execute: this.executeFileStat.bind(this),
    };

    tools.grep = {
      description: "Search file content by regular expression.",
      inputSchema: jsonSchema<GrepInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          caseSensitive: { type: "boolean" },
          maxResults: { type: "number" },
        },
        required: ["pattern"],
      }),
      execute: this.executeGrep.bind(this),
    };

    if (this.filesystem.readOnly) {
      return;
    }

    tools.write_file = {
      description: "Write content to a file.",
      inputSchema: jsonSchema<WriteFileInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      }),
      execute: this.executeWriteFile.bind(this),
    };

    tools.edit_file = {
      description: "Edit file content by string replacement.",
      inputSchema: jsonSchema<EditFileInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          replaceAll: { type: "boolean" },
        },
        required: ["path", "oldText", "newText"],
      }),
      execute: this.executeEditFile.bind(this),
    };

    tools.delete = {
      description: "Delete a file or directory.",
      inputSchema: jsonSchema<DeleteInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
        },
        required: ["path"],
      }),
      execute: this.executeDelete.bind(this),
    };

    tools.mkdir = {
      description: "Create a directory recursively.",
      inputSchema: jsonSchema<MkdirInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      }),
      execute: this.executeMkdir.bind(this),
    };
  }

  private registerSandboxTools(tools: WorkspaceToolSet): void {
    if (!this.sandbox) {
      return;
    }

    tools.execute_command = {
      description: "Execute a shell command in workspace.",
      inputSchema: jsonSchema<ExecuteCommandInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["command"],
      }),
      execute: this.executeCommand.bind(this),
    };
  }

  private requireFilesystem(): LocalFilesystem {
    if (!this.filesystem) {
      throw new Error("Workspace filesystem is not configured");
    }
    return this.filesystem;
  }

  private requireSandbox(): LocalSandbox {
    if (!this.sandbox) {
      throw new Error("Workspace sandbox is not configured");
    }
    return this.sandbox;
  }

  private async executeReadFile(input: ReadFileInput): Promise<{ path: string; content: string }> {
    const filesystem = this.requireFilesystem();
    const rawContent = await filesystem.readFile(input.path);
    const lines = rawContent.split(/\r?\n/);
    const fromLine = Math.max(1, input.startLine ?? 1);
    const toLine = Math.max(fromLine, input.endLine ?? lines.length);
    const content = lines.slice(fromLine - 1, toLine).join("\n");
    return {
      path: input.path,
      content,
    };
  }

  private async executeWriteFile(
    input: WriteFileInput,
  ): Promise<{ path: string; written: boolean }> {
    const filesystem = this.requireFilesystem();
    await filesystem.writeFile(input.path, input.content);
    return {
      path: input.path,
      written: true,
    };
  }

  private async executeEditFile(input: EditFileInput): Promise<{ path: string; replaced: number }> {
    const filesystem = this.requireFilesystem();
    const result = await filesystem.editFile(input);
    return {
      path: input.path,
      replaced: result.replaced,
    };
  }

  private async executeListFiles(input: ListFilesInput): Promise<{ entries: PathTypeEntry[] }> {
    const filesystem = this.requireFilesystem();
    const entries = await filesystem.listFiles(
      input.path,
      input.recursive ?? false,
      input.maxDepth,
    );
    return { entries };
  }

  private async executeDelete(input: DeleteInput): Promise<{ path: string; deleted: boolean }> {
    const filesystem = this.requireFilesystem();
    await filesystem.delete(input.path, input.recursive ?? false);
    return {
      path: input.path,
      deleted: true,
    };
  }

  private async executeFileStat(input: FileStatInput): Promise<{
    path: string;
    type: FileType;
    size: number;
    modifiedAt: string;
  }> {
    const filesystem = this.requireFilesystem();
    const fileStat = await filesystem.fileStat(input.path);
    return {
      path: fileStat.path,
      type: fileStat.type,
      size: fileStat.size,
      modifiedAt: fileStat.modifiedAt.toISOString(),
    };
  }

  private async executeMkdir(input: MkdirInput): Promise<{ path: string; created: boolean }> {
    const filesystem = this.requireFilesystem();
    await filesystem.mkdir(input.path);
    return {
      path: input.path,
      created: true,
    };
  }

  private async executeGrep(input: GrepInput): Promise<{
    matches: Array<{ path: string; line: number; content: string }>;
  }> {
    const filesystem = this.requireFilesystem();
    const matches = await filesystem.grep(input);
    return { matches };
  }

  private async executeCommand(input: ExecuteCommandInput): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
  }> {
    const sandbox = this.requireSandbox();
    return sandbox.executeCommand(input);
  }
}
