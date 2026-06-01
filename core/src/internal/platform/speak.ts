import { h, type Element, type Fragment, type Session } from "koishi";

// ============================================================================
// SpeakElement types (migrated from types.ts)
// ============================================================================

export interface SpeakElementContext {
  channel: { platform: string; channelId: string; type: "private" | "group" };
  session?: Session;
}

export interface SpeakElementDefinition {
  tag: string;
  syntax: string;
  description: string;
  examples?: string[];
  transform?: (element: Element, context: SpeakElementContext) => Fragment | Promise<Fragment>;
}

export interface SpeakElementPromptInfo {
  tag: string;
  syntax: string;
  description: string;
  examples: string[];
}

export interface SpeakAnomaly {
  version: 1;
  kind: "transform_failed" | "send_failed" | "partial_failed" | "cancelled";
  timestamp: number;
  source: "athena-bot";
  reason: string;
  generatedContent: string;
  attemptedSegments: string[];
  deliveredSegments?: string[];
  failedSegments?: string[];
  error?: unknown;
}

// ============================================================================
// SpeakElementRegistry
// ============================================================================

export interface CompileSpeakResult {
  segments: string[];
  anomalies: SpeakAnomaly[];
}

export interface SpeakElementRegistry {
  register(definition: SpeakElementDefinition): () => void;
  getPromptElements(): SpeakElementPromptInfo[];
  compile(content: string | Fragment, context: SpeakElementContext): Promise<CompileSpeakResult>;
}

const SEP_PROMPT: SpeakElementPromptInfo = {
  tag: "sep",
  syntax: "<sep/>",
  description: "Split one assistant reply into multiple platform messages with natural delays.",
  examples: ["这个啊<sep/>我想一下..."],
};

export function createSpeakElementRegistry(): SpeakElementRegistry {
  const definitions = new Map<string, SpeakElementDefinition>();

  return {
    register(definition) {
      if (definition.tag === "sep") {
        throw new Error('Speak element "sep" is reserved by Athena Bot');
      }

      if (definitions.has(definition.tag)) {
        throw new Error(`Speak element "${definition.tag}" is already registered`);
      }

      definitions.set(definition.tag, definition);

      return () => {
        if (definitions.get(definition.tag) === definition) {
          definitions.delete(definition.tag);
        }
      };
    },

    getPromptElements() {
      return [
        SEP_PROMPT,
        ...Array.from(definitions.values()).map((definition) => ({
          tag: definition.tag,
          syntax: definition.syntax,
          description: definition.description,
          examples: definition.examples ?? [],
        })),
      ];
    },

    async compile(content, context) {
      const source = typeof content === "string" ? h.parse(content) : normalizeFragment(content);
      const anomalies: SpeakAnomaly[] = [];
      const transformed = await transformElements(source, definitions, context, anomalies, content);

      return {
        segments: splitBySep(transformed),
        anomalies,
      };
    },
  };
}

async function transformElements(
  elements: Element[],
  definitions: Map<string, SpeakElementDefinition>,
  context: SpeakElementContext,
  anomalies: SpeakAnomaly[],
  generatedContent: string | Fragment,
): Promise<Array<string | Element>> {
  const output: Array<string | Element> = [];

  for (const element of elements) {
    if (element.type === "text") {
      output.push(String(element.attrs.content ?? ""));
      continue;
    }

    if (element.type === "sep") {
      output.push(h("sep"));
      continue;
    }

    const definition = definitions.get(String(element.type));
    if (!definition) {
      appendText(output, element.toString());
      continue;
    }

    try {
      const transformed = definition.transform
        ? await definition.transform(element, context)
        : ([element] as Fragment);
      output.push(...normalizeFragment(transformed));
    } catch (error) {
      anomalies.push(createTransformAnomaly(error, generatedContent));
    }
  }

  return output;
}

function normalizeFragment(fragment: Fragment): Element[] {
  if (typeof fragment === "string") {
    return h.parse(fragment);
  }

  if (Array.isArray(fragment)) {
    return fragment.flatMap((part) => {
      if (typeof part === "string") {
        return h.parse(part);
      }

      return [part];
    });
  }

  return [fragment];
}

function splitBySep(items: Array<string | Element>): string[] {
  const segments: string[] = [];
  let current: Array<string | Element> = [];

  for (const item of items) {
    if (typeof item !== "string" && item.type === "sep") {
      pushSegment(segments, current);
      current = [];
      continue;
    }

    current.push(item);
  }

  pushSegment(segments, current);

  return segments;
}

function pushSegment(segments: string[], items: Array<string | Element>): void {
  const compact = items.filter((item) => (typeof item === "string" ? item.length > 0 : true));
  if (compact.length === 0) return;
  segments.push(
    compact.map((item) => (typeof item === "string" ? item : item.toString())).join(""),
  );
}

function appendText(output: Array<string | Element>, text: string): void {
  if (text.length === 0) return;

  const previous = output[output.length - 1];
  if (typeof previous === "string") {
    output[output.length - 1] = previous + text;
    return;
  }

  output.push(text);
}

function createTransformAnomaly(error: unknown, generatedContent: string | Fragment): SpeakAnomaly {
  return {
    version: 1,
    kind: "transform_failed",
    timestamp: Date.now(),
    source: "athena-bot",
    reason: error instanceof Error ? error.message : String(error),
    generatedContent: stringifyFragment(generatedContent),
    attemptedSegments: [],
    error: serializeError(error),
  };
}

function stringifyFragment(fragment: string | Fragment): string {
  if (typeof fragment === "string") {
    return fragment;
  }

  return normalizeFragment(fragment)
    .map((element) => element.toString())
    .join("");
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    };
  }

  return error;
}
