import type { ImagePart, LanguageModel } from "ai";

import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
} from "./types.js";

type AgentListener = (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

export type QueueMode = "all" | "one-at-a-time";

export interface InitialState {
  systemPrompt?: string;
  model?: LanguageModel;
  tools?: Record<string, AgentTool>;
  messages?: AgentMessage[];
}

type MutableAgentState = Omit<
  AgentState,
  "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

function createMutableAgentState(initialState?: InitialState): MutableAgentState {
  let tools = { ...(initialState?.tools ?? {}) };
  let messages = [...(initialState?.messages ?? [])];

  return {
    systemPrompt: initialState?.systemPrompt ?? "",
    model: initialState?.model as LanguageModel,
    get tools() {
      return tools;
    },
    set tools(nextTools: Record<string, AgentTool>) {
      tools = { ...nextTools };
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = [...nextMessages];
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

export interface AgentOptions {
  model: LanguageModel;
  systemPrompt?: string;
  convertToLlm: AgentLoopConfig["convertToLlm"];
  transformContext?: AgentLoopConfig["transformContext"];
  tools?: Record<string, AgentTool>;
  maxSteps?: number;
  beforeToolCall?: AgentLoopConfig["beforeToolCall"];
  afterToolCall?: AgentLoopConfig["afterToolCall"];
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}

class PendingMessageQueue {
  private messages: AgentMessage[] = [];

  constructor(public mode: QueueMode) {}

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }

    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}

export class Agent {
  private readonly listeners = new Set<AgentListener>();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;
  private readonly _state: MutableAgentState;
  private activeRun?: ActiveRun;

  public convertToLlm: AgentLoopConfig["convertToLlm"];
  public transformContext?: AgentLoopConfig["transformContext"];
  public beforeToolCall?: AgentLoopConfig["beforeToolCall"];
  public afterToolCall?: AgentLoopConfig["afterToolCall"];
  public maxSteps?: number;

  constructor(options: AgentOptions) {
    this._state = createMutableAgentState({
      systemPrompt: options.systemPrompt,
      model: options.model,
      tools: options.tools,
    });
    this.convertToLlm = options.convertToLlm;
    this.transformContext = options.transformContext;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.maxSteps = options.maxSteps;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
  }

  get state(): AgentState {
    return this._state;
  }

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  abort(): void {
    this.activeRun?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this._state.errorMessage = undefined;
    this.clearAllQueues();
  }

  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImagePart[]): Promise<void>;
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImagePart[]): Promise<void> {
    if (this.activeRun) {
      throw new Error(
        "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
      );
    }

    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
  }

  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing. Wait for completion before continuing.");
    }

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (!lastMessage) {
      throw new Error("No messages to continue from");
    }

    if (lastMessage.role === "assistant") {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        await this.runPromptMessages(queuedFollowUps);
        return;
      }

      throw new Error("No steering or follow-up messages queued after assistant message");
    }

    await this.runContinuation();
  }

  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImagePart[],
  ): AgentMessage[] {
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input !== "string") {
      return [input];
    }

    return [
      {
        role: "user",
        content: [{ type: "text", text: input }, ...(images ?? [])],
        timestamp: Date.now(),
      },
    ];
  }

  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        this.createLoopConfig(options),
        (event) => this.processEvents(event),
        signal,
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        this.createLoopConfig(),
        (event) => this.processEvents(event),
        signal,
      );
    });
  }

  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: { ...this._state.tools },
    };
  }

  private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
    return {
      model: this._state.model,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      beforeToolCall: this.beforeToolCall,
      afterToolCall: this.afterToolCall,
      maxSteps: this.maxSteps,
      skipInitialSteeringPoll: options.skipInitialSteeringPoll === true,
      getSteeringMessages: async () => this.steeringQueue.drain(),
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }

  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing.");
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;
    this._state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.finishRun();
    }
  }

  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      finishReason: aborted ? "abort" : "error",
      usage: {},
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    };
    this._state.messages.push(failureMessage);
    this._state.errorMessage = failureMessage.errorMessage;
    await this.processEvents({ type: "agent_end", messages: [failureMessage] });
  }

  private finishRun(): void {
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

  private async processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "message_start":
      case "message_update":
        this._state.streamingMessage =
          event.message.role === "assistant" ? event.message : undefined;
        break;
      case "message_end":
        this._state.streamingMessage = undefined;
        this._state.messages.push(event.message);
        break;
      case "tool_execution_start": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }
      case "tool_execution_end": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }
      case "turn_end":
        if (event.message.role === "assistant" && event.message.errorMessage) {
          this._state.errorMessage = event.message.errorMessage;
        }
        break;
      case "agent_end":
        this._state.streamingMessage = undefined;
        break;
      default:
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error("Agent listener invoked outside active run");
    }

    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
