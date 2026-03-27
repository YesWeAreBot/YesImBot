import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type { AthenaToolDefinition, ChannelContext } from "./tool-types";

interface NoteRecord {
  content: string;
  updatedAt: number;
}

interface NotesData {
  notes: Record<string, NoteRecord>;
}

const EMPTY_NOTES_JSON = '{"notes":{}}';

function readNotesData(channelCtx: ChannelContext): NotesData {
  const notesPath = join(channelCtx.sessionDir, "notes.json");
  const content = existsSync(notesPath) ? readFileSync(notesPath, "utf-8") : EMPTY_NOTES_JSON;
  const parsed = JSON.parse(content) as NotesData;
  return {
    notes: parsed.notes ?? {},
  };
}

function writeNotesData(channelCtx: ChannelContext, data: NotesData): void {
  const notesPath = join(channelCtx.sessionDir, "notes.json");
  writeFileSync(notesPath, JSON.stringify(data, null, 2), "utf-8");
}

const LIST_NOTES_PARAMS = Type.Object({});

interface NoteSummary {
  title: string;
  updatedAt: number;
}

interface ListNotesDetails {
  count: number;
  notes: NoteSummary[];
}

type ListNotesResult = AgentToolResult<ListNotesDetails> & { isError?: boolean };

export function createListNotesTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "list_notes",
    label: "List Notes",
    description: "List all note titles with their last updated timestamps for this channel.",
    promptSnippet: "list_notes() — list all notes in this channel",
    parameters: LIST_NOTES_PARAMS,
    async execute(): Promise<ListNotesResult> {
      try {
        const data = readNotesData(channelCtx);
        const notes = Object.entries(data.notes).map(([title, note]) => ({
          title,
          updatedAt: note.updatedAt,
        }));

        return {
          content: [
            {
              type: "text",
              text: notes.length > 0 ? `Found ${notes.length} note(s)` : "No notes found",
            },
          ],
          details: { count: notes.length, notes },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error listing notes: ${errorMessage}` }],
          details: { count: 0, notes: [] },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}

const READ_NOTE_PARAMS = Type.Object({
  title: Type.String({ description: "The title of the note to read" }),
});

interface ReadNoteDetails {
  title: string;
  content: string;
  updatedAt: number;
}

type ReadNoteResult = AgentToolResult<ReadNoteDetails> & { isError?: boolean };

export function createReadNoteTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "read_note",
    label: "Read Note",
    description: "Read one note by title from this channel's note store.",
    promptSnippet: "read_note(title) — read a specific note",
    parameters: READ_NOTE_PARAMS,
    async execute(_toolCallId, params): Promise<ReadNoteResult> {
      try {
        const typedParams = params as { title: string };
        const data = readNotesData(channelCtx);
        const note = data.notes[typedParams.title];

        if (!note) {
          return {
            content: [{ type: "text", text: `Note "${typedParams.title}" not found` }],
            details: { title: typedParams.title, content: "", updatedAt: 0 },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Read note "${typedParams.title}"` }],
          details: {
            title: typedParams.title,
            content: note.content,
            updatedAt: note.updatedAt,
          },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error reading note: ${errorMessage}` }],
          details: { title: "", content: "", updatedAt: 0 },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}

const WRITE_NOTE_PARAMS = Type.Object({
  title: Type.String({ description: "The note title" }),
  content: Type.String({ description: "The note content" }),
});

interface WriteNoteDetails {
  title: string;
  saved: boolean;
  updatedAt: number;
}

type WriteNoteResult = AgentToolResult<WriteNoteDetails> & { isError?: boolean };

export function createWriteNoteTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "write_note",
    label: "Write Note",
    description: "Create or overwrite a note by title in this channel.",
    promptSnippet: "write_note(title, content) — save a note",
    parameters: WRITE_NOTE_PARAMS,
    async execute(_toolCallId, params): Promise<WriteNoteResult> {
      try {
        const typedParams = params as { title: string; content: string };
        const data = readNotesData(channelCtx);
        const updatedAt = Date.now();
        data.notes[typedParams.title] = {
          content: typedParams.content,
          updatedAt,
        };
        writeNotesData(channelCtx, data);

        return {
          content: [{ type: "text", text: `Note "${typedParams.title}" saved` }],
          details: { title: typedParams.title, saved: true, updatedAt },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error saving note: ${errorMessage}` }],
          details: { title: "", saved: false, updatedAt: 0 },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}

const DELETE_NOTE_PARAMS = Type.Object({
  title: Type.String({ description: "The title of the note to delete" }),
});

interface DeleteNoteDetails {
  title: string;
  deleted: boolean;
}

type DeleteNoteResult = AgentToolResult<DeleteNoteDetails> & { isError?: boolean };

export function createDeleteNoteTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "delete_note",
    label: "Delete Note",
    description: "Delete one note by title from this channel's note store.",
    promptSnippet: "delete_note(title) — remove a note",
    parameters: DELETE_NOTE_PARAMS,
    async execute(_toolCallId, params): Promise<DeleteNoteResult> {
      try {
        const typedParams = params as { title: string };
        const data = readNotesData(channelCtx);

        if (!data.notes[typedParams.title]) {
          return {
            content: [{ type: "text", text: `Note "${typedParams.title}" not found` }],
            details: { title: typedParams.title, deleted: false },
            isError: true,
          };
        }

        delete data.notes[typedParams.title];
        writeNotesData(channelCtx, data);

        return {
          content: [{ type: "text", text: `Note "${typedParams.title}" deleted` }],
          details: { title: typedParams.title, deleted: true },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error deleting note: ${errorMessage}` }],
          details: { title: "", deleted: false },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}

const READ_ALL_NOTES_PARAMS = Type.Object({});

interface ReadAllNotesDetails {
  count: number;
  notes: Record<string, NoteRecord>;
}

type ReadAllNotesResult = AgentToolResult<ReadAllNotesDetails> & { isError?: boolean };

export function createReadAllNotesTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "read_all_notes",
    label: "Read All Notes",
    description: "Read all notes (titles, content, timestamps) for this channel.",
    promptSnippet: "read_all_notes() — retrieve every note",
    parameters: READ_ALL_NOTES_PARAMS,
    async execute(): Promise<ReadAllNotesResult> {
      try {
        const data = readNotesData(channelCtx);
        const count = Object.keys(data.notes).length;

        return {
          content: [{ type: "text", text: `Retrieved ${count} note(s)` }],
          details: { count, notes: data.notes },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error retrieving notes: ${errorMessage}` }],
          details: { count: 0, notes: {} },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}
