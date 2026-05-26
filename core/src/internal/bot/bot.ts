import { h, type Bot, type Fragment, type Session } from "koishi";

import { planDeliveryTiming, type DeliverySettings } from "../delivery.js";
import type { Channel } from "../extension/types.js";
import {
  createPresenterRegistry,
  type PresenterCatalog,
  type PresenterRegistry,
} from "./presentation.js";
import type { SpeakElementRegistry } from "./speak.js";
import type { AthenaEvent, BotPresentation, SpeakAnomaly } from "./types.js";

export interface AthenaBotOptions {
  channel: Channel;
  presenterCatalog: PresenterCatalog;
  speakElements: SpeakElementRegistry;
  deliverySettings: DeliverySettings;
  appendEntry(customType: string, data?: unknown): void;
}

export interface SpeakOptions {
  originSession?: Session;
  modelElapsedMs?: number;
  signal?: AbortSignal;
}

export interface SpeakResult {
  ok: boolean;
  attemptedSegments: string[];
  deliveredSegments: string[];
  failedSegments: string[];
  anomalies: SpeakAnomaly[];
}

export class AthenaBot {
  private readonly channel: Channel;
  private readonly presenters: PresenterRegistry;
  private readonly speakElements: SpeakElementRegistry;
  private readonly deliverySettings: DeliverySettings;
  private readonly appendEntry: AthenaBotOptions["appendEntry"];
  private seedCounter = 0;

  constructor(options: AthenaBotOptions) {
    this.channel = options.channel;
    this.presenters = createPresenterRegistry();
    options.presenterCatalog.applyTo(this.presenters);
    this.speakElements = options.speakElements;
    this.deliverySettings = options.deliverySettings;
    this.appendEntry = options.appendEntry;
  }

  present(event: AthenaEvent): Promise<BotPresentation | null> {
    return this.presenters.present(event, { selfId: this.channel.bot?.selfId ?? "unknown" });
  }

  async speak(content: string | Fragment, options: SpeakOptions = {}): Promise<SpeakResult> {
    const compiled = await this.speakElements.compile(content, {
      channel: this.channel,
      session: options.originSession,
    });
    const attemptedSegments = compiled.segments.map(stringifyFragment);
    const deliveredSegments: string[] = [];
    const failedSegments: string[] = [];
    const anomalies = [...compiled.anomalies];
    const timing = planDeliveryTiming({
      modelElapsedMs: options.modelElapsedMs ?? 0,
      initialDelayMinMs: this.deliverySettings.timing.initialDelayMinMs,
      initialDelayMaxMs: this.deliverySettings.timing.initialDelayMaxMs,
      followupDelayMinMs: this.deliverySettings.timing.followupDelayMinMs,
      followupDelayMaxMs: this.deliverySettings.timing.followupDelayMaxMs,
      minimumBufferMinMs: this.deliverySettings.timing.minimumBufferMinMs,
      minimumBufferMaxMs: this.deliverySettings.timing.minimumBufferMaxMs,
      segmentCount: compiled.segments.length,
      seed: this.nextSeed(),
    });

    for (const [index, segment] of compiled.segments.entries()) {
      const delay = index === 0 ? timing.firstDelayMs : (timing.followupDelaysMs[index - 1] ?? 0);
      if (delay > 0) {
        await sleep(delay, options.signal);
      }

      if (options.signal?.aborted) {
        const remaining = attemptedSegments.slice(index);
        failedSegments.push(...remaining);
        anomalies.push(
          createSpeakAnomaly("cancelled", "speak cancelled", content, attemptedSegments, {
            deliveredSegments,
            failedSegments: remaining,
          }),
        );
        break;
      }

      try {
        await this.sendFragment(segment, options.originSession);
        deliveredSegments.push(attemptedSegments[index]);
      } catch (error) {
        const failed = attemptedSegments[index];
        failedSegments.push(failed);
        anomalies.push(
          createSpeakAnomaly("send_failed", getErrorMessage(error), content, attemptedSegments, {
            deliveredSegments,
            failedSegments: [failed],
            error,
          }),
        );
      }
    }

    if (failedSegments.length > 0 && deliveredSegments.length > 0) {
      anomalies.push(
        createSpeakAnomaly(
          "partial_failed",
          `${failedSegments.length} segment(s) failed`,
          content,
          attemptedSegments,
          { deliveredSegments, failedSegments },
        ),
      );
    }

    this.persistSpeakAnomalies(anomalies);

    return {
      ok: failedSegments.length === 0,
      attemptedSegments,
      deliveredSegments,
      failedSegments,
      anomalies,
    };
  }

  persistSpeakAnomalies(anomalies: SpeakAnomaly[]): void {
    for (const anomaly of anomalies) {
      this.appendEntry("athena:speak_anomaly", {
        display: false,
        details: anomaly,
      });
    }
  }

  registerSpeakElement(definition: Parameters<SpeakElementRegistry["register"]>[0]): () => void {
    return this.speakElements.register(definition);
  }

  getSpeakElementPrompts() {
    return this.speakElements.getPromptElements();
  }

  private async sendFragment(fragment: Fragment, originSession?: Session): Promise<void> {
    const message = toOutgoingMessage(fragment);

    if (originSession) {
      await originSession.send(message);
      return;
    }

    const bot = this.channel.bot as Bot | undefined;
    if (!bot) {
      throw new Error("No Koishi bot available for active send");
    }

    await bot.sendMessage(this.channel.channelId, message);
  }

  private nextSeed(): number {
    return Date.now() + this.seedCounter++;
  }
}

function toOutgoingMessage(fragment: Fragment): string | Fragment {
  if (typeof fragment === "string") {
    return fragment;
  }

  if (Array.isArray(fragment) && fragment.every((item) => typeof item === "string")) {
    return fragment.join("");
  }

  return fragment;
}

function stringifyFragment(fragment: Fragment): string {
  if (typeof fragment === "string") {
    return fragment;
  }

  if (Array.isArray(fragment) && fragment.every((item) => typeof item === "string")) {
    return fragment.join("");
  }

  return h("", fragment).toString();
}

function createSpeakAnomaly(
  kind: SpeakAnomaly["kind"],
  reason: string,
  generatedContent: string | Fragment,
  attemptedSegments: string[],
  extras: {
    deliveredSegments?: string[];
    failedSegments?: string[];
    error?: unknown;
  } = {},
): SpeakAnomaly {
  return {
    version: 1,
    kind,
    timestamp: Date.now(),
    source: "athena-bot",
    reason,
    generatedContent: stringifyFragment(generatedContent),
    attemptedSegments,
    ...(extras.deliveredSegments?.length ? { deliveredSegments: extras.deliveredSegments } : {}),
    ...(extras.failedSegments?.length ? { failedSegments: extras.failedSegments } : {}),
    ...(extras.error !== undefined ? { error: serializeError(extras.error) } : {}),
  };
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
