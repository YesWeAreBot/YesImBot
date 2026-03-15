import { Element, h, Schema, sleep } from "koishi";

import type { FormatterService } from "../../formatter/service";
import type { HookService } from "../../hook/service";
import { HookType } from "../../hook/types";
import { Action, Metadata, Tool, withInnerThoughts } from "../decorators";
import { YesImPlugin } from "../plugin";
import { ToolExecutionContext, ToolResult } from "../types";
import { Failed, Success } from "../utils";

// Prohibited elements that the LLM must not trigger
const PROHIBITED_ELEMENTS = ["execute", "prompt"];

/**
 * Filter out interactive components per security policy.
 * Text nodes are kept, prohibited elements are removed,
 * and children are recursively filtered.
 */
function filterInteractive(elements: Element[]): Element[] {
  return elements
    .filter((elem) => {
      if (typeof elem === "string") return true;
      return !PROHIBITED_ELEMENTS.includes(elem.type);
    })
    .map((elem) => {
      if (typeof elem === "string" || !elem.children?.length) return elem;
      return { ...elem, children: filterInteractive(elem.children) };
    });
}

@Metadata({ name: "core", description: "Core built-in tools", builtin: true })
export class CorePlugin extends YesImPlugin {
  static inject = ["yesimbot.plugin", "yesimbot.horizon", "yesimbot.hook", "yesimbot.formatter"];

  private resolveNativeMsgId(ctx: ToolExecutionContext, shortIdStr: string): string | null {
    const shortId = Number(shortIdStr);
    if (!Number.isInteger(shortId) || shortId < 0) return null;
    const channelKey = `${ctx.platform}:${ctx.channelId}`;
    const horizon = this.ctx["yesimbot.horizon"];
    return horizon?.lookupNativeMsgId(channelKey, shortId) ?? null;
  }

  @Tool({
    name: "execute",
    description:
      "Execute a Koishi command from another plugin in the current session and return its output. " +
      "The command runs with the current channel, user authority, locale, and plugin context. " +
      "Use this when an existing Koishi command already provides the capability you need.",
    parameters: withInnerThoughts({
      command: Schema.string()
        .required()
        .description(
          "Koishi command text to execute in the current session. " +
            "Use plain command text such as 'help weather' or 'status --verbose'. " +
            "Do not use this for normal chatting; use send_message for that.",
        ),
      expose_to_user: Schema.boolean()
        .default(false)
        .description(
          "Whether to also send the captured command output directly to the current conversation. " +
            "Keep false when you only need the result privately for reasoning. " +
            "Set true only when the command result itself should be shown to the user.",
        ),
    }),
    requiredCapabilities: ["platform.session"],
    onCapabilityMissing: "remove",
  })
  async executeCommand(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const session = ctx.session;
      if (!session) return Failed("No active session");

      const command = String(params["command"] ?? "").trim();
      if (!command) return Failed("command is required");
      const exposeToUser = params["expose_to_user"] === true;

      const result = await session.execute(command, true);
      const formatter = this.ctx["yesimbot.formatter"] as FormatterService | undefined;
      const content = Array.isArray(result)
        ? formatter
          ? (await formatter.format(result as Element[], session)).trim()
          : result
              .map((part) => (typeof part === "string" ? part : part.toString()))
              .join("")
              .trim()
        : result == null
          ? ""
          : String(result).trim();

      if (exposeToUser && content) {
        try {
          const exposed = Array.isArray(result)
            ? filterInteractive(result as Element[])
            : filterInteractive(h.parse(content));
          await session.send(exposed);
        } catch (emitError) {
          return Success(
            `${content}\n\n[Warning: failed to expose command output to user: ${
              emitError instanceof Error ? emitError.message : String(emitError)
            }]`,
          );
        }
      }

      if (!content) {
        return Success(
          "Command finished with no visible output. " +
            "It may have succeeded silently, been filtered by context/authority, or produced no response.",
        );
      }

      return Success(content);
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  @Action({
    name: "send_message",
    description:
      "Send a message to the current channel. This is the primary way to communicate with users. " +
      "Supports plain text, message splitting with <sep/>, and replying to messages.",
    parameters: withInnerThoughts({
      content: Schema.string()
        .required()
        .description(
          "Message content to send. " +
            "Use <sep/> to split long messages with natural delays between parts. " +
            "Example: 'Hello <sep/> World' sends two separate messages.",
        ),
      target: Schema.object({
        platform: Schema.string()
          .required()
          .description("Target platform (e.g., 'onebot', 'discord')"),
        channelId: Schema.string().required().description("Target channel ID"),
      })
        .description(
          "(Advanced) Optional target to send to a different channel. " +
            "Most of the time you don't need this—just omit it to send to the current channel. " +
            "Cannot use with replyTo.",
        )
        .hidden(),
      replyTo: Schema.string().description(
        "Short message ID to reply to (from <msg id=...> tags in context). " +
          "The reply is sent to the current channel automatically. Cannot use with target.",
      ),
    }),
    requiredCapabilities: ["platform.session"],
    onCapabilityMissing: "remove",
  })
  async sendMessage(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const hookService = this.ctx["yesimbot.hook"];
    let content = String(params["content"] ?? "");
    try {
      const target = params["target"] as { platform: string; channelId: string } | undefined;
      const replyToStr = params["replyTo"] as string | undefined;

      // Message before hook
      if (hookService) {
        const beforeResult = await hookService.executeBefore(
          HookType.Message,
          { content, session: ctx.session },
          ctx.percept?.traceId,
        );
        if (beforeResult.skipped) {
          return beforeResult.result as ToolResult;
        }
        content = (beforeResult.params as { content: string }).content;
      }

      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveParts = parts.length ? parts : [content];

      // Resolve replyTo to native message ID
      let replyToNativeId: string | undefined;
      if (replyToStr) {
        if (target) {
          return Failed(
            "Cannot specify both 'replyTo' and 'target'. When replying to a message, " +
              "the reply is sent to the current session's channel automatically.",
          );
        }
        replyToNativeId =
          this.resolveNativeMsgId(ctx, replyToStr) ?? ctx.session?.messageId ?? undefined;
        if (!replyToNativeId) {
          return Failed("Message not found in current context");
        }
      }

      if (target) {
        const { platform, channelId } = target;
        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) return Failed(`Bot not found for platform: ${platform}`);
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          const parsed = filterInteractive(h.parse(effectiveParts[i]!));
          // Cross-channel send - hook already executed above
          // See docs/HOOK_COVERAGE.md for message hook coverage
          await bot.sendMessage(channelId, parsed);
        }
      } else {
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          const msgContent = effectiveParts[i]!;
          const parsedContent = h.parse(msgContent);
          const filteredContent = filterInteractive(parsedContent);
          const elements =
            i === 0 && replyToNativeId
              ? [h("quote", { id: replyToNativeId }), ...filteredContent]
              : filteredContent;
          // Current channel send - hook already executed above
          // See docs/HOOK_COVERAGE.md for message hook coverage
          await ctx.session?.send(elements);
        }
      }
      return Success(`Sent ${effectiveParts.length} message(s)`);
    } catch (e) {
      if (hookService) {
        await hookService.executeError(
          HookType.Message,
          { content, session: ctx.session },
          e instanceof Error ? e : new Error(String(e)),
          ctx.percept?.traceId,
        );
      }
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}
