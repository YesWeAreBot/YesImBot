import { jsonrepair, JSONRepairError } from "jsonrepair";

export interface Logger {
  info(message: string): void;
}

export interface ParseResult<T> {
  data: T | null;
  error: string | null;
  logs: string[];
}

export class JsonParser<T> {
  private logger?: Logger;
  private logs: string[] = [];

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  private log(message: string): void {
    this.logger?.info(message);
    this.logs.push(message);
  }

  parse(rawOutput: string): ParseResult<T> {
    this.logs = [];
    this.log(`Start parsing, input length: ${rawOutput.length}`);

    let str = rawOutput.trim();

    // Extract markdown code block if present and string doesn't start with JSON
    const codeBlockIdx = str.indexOf("```json");
    const isJsonStart = this.isLikelyJsonStart(str);

    if (codeBlockIdx !== -1 && !isJsonStart) {
      const endIdx = str.lastIndexOf("```");
      let content =
        endIdx > codeBlockIdx
          ? str.substring(codeBlockIdx + 3, endIdx)
          : str.substring(codeBlockIdx + 3);

      // Remove language identifier line
      const nl = content.indexOf("\n");
      if (nl !== -1) {
        const firstLine = content.substring(0, nl).trim();
        if (!firstLine.startsWith("{") && !firstLine.startsWith("[")) {
          content = content.substring(nl + 1);
        }
      }
      str = content.trim();
      this.log(`Extracted from code block, length: ${str.length}`);
    } else if (codeBlockIdx !== -1) {
      const endIdx = str.lastIndexOf("```");
      if (endIdx > codeBlockIdx) {
        str = str.substring(codeBlockIdx + 3, endIdx).trim();
      }
    }

    // Find JSON start
    const firstBrace = str.indexOf("{");
    const firstBracket = str.indexOf("[");
    let startIndex = -1;

    if (firstBrace !== -1 && firstBracket !== -1) {
      startIndex = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIndex = firstBrace;
    } else {
      startIndex = firstBracket;
    }

    if (startIndex === -1) {
      this.log("No JSON start symbol found, will attempt repair on full string");
    } else if (startIndex > 0) {
      this.log(`Found JSON start at index ${startIndex}, discarding ${startIndex} leading chars`);
      str = str.substring(startIndex);
    }

    // Trim trailing text if brackets are balanced
    const openBraces = (str.match(/{/g) || []).length;
    const closeBraces = (str.match(/}/g) || []).length;
    const openBrackets = (str.match(/\[/g) || []).length;
    const closeBrackets = (str.match(/]/g) || []).length;

    if (openBraces === closeBraces && openBrackets === closeBrackets) {
      const endIndex = Math.max(str.lastIndexOf("}"), str.lastIndexOf("]"));
      if (endIndex > -1 && endIndex < str.length - 1) {
        this.log("Balanced structure, trimming trailing text");
        str = str.substring(0, endIndex + 1);
      }
    }

    if (str.length === 0) {
      return { data: null, error: "No valid JSON content found", logs: this.logs };
    }

    try {
      let data: T;
      try {
        data = JSON.parse(str) as T;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`Direct parse failed: ${msg}`);
        const repaired = jsonrepair(str);
        data = JSON.parse(repaired) as T;
      }

      if (typeof data !== "object" && startIndex === -1) {
        this.log("Parsed non-object but input lacks clear JSON start, treating as failure");
        return { data: null, error: "Could not parse as JSON object or array", logs: this.logs };
      }

      this.log("Parse completed successfully");
      return { data, error: null, logs: this.logs };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`Final parse failed: ${msg}`);
      if (e instanceof JSONRepairError) {
        const err = e as unknown as { line?: number; column?: number };
        if (err.line && err.column) {
          this.log(`${str.split("\n")[err.line - 1]}`);
          this.log(`${" ".repeat(err.column - 1)}^`);
        }
      }
      return { data: null, error: msg, logs: this.logs };
    }
  }

  /**
   * Check if string likely starts with valid JSON structure.
   * Avoids false positives like `[OBSERVE]` being treated as JSON array.
   */
  isLikelyJsonStart(str: string): boolean {
    const trimmed = str.trim();

    if (trimmed.startsWith("{")) return true;

    if (trimmed.startsWith("[")) {
      const ch = trimmed.substring(1).trim().charAt(0);
      return (
        ch === "]" || ch === "{" || ch === '"' ||
        ch === "t" || ch === "f" || ch === "n" ||
        (ch >= "0" && ch <= "9") || ch === "-"
      );
    }

    return false;
  }
}
