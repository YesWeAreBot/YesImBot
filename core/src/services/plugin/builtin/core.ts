import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Element, h, Random, Schema, sleep } from "koishi";

import type { MessageEventData } from "../../horizon/types";
import { TimelineStage } from "../../horizon/types";
import type { SkillRegistry } from "../../skill/service";
import type { AgentSessionStore } from "../../skill/session-store";
import type { SkillDefinition } from "../../skill/types";
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
  static inject = ["yesimbot.plugin", "yesimbot.horizon", "yesimbot.skill", "yesimbot.session"];

  private resolveNativeMsgId(ctx: ToolExecutionContext, shortIdStr: string): string | null {
    const shortId = Number(shortIdStr);
    if (!Number.isInteger(shortId) || shortId < 0) return null;
    const channelKey = `${ctx.platform}:${ctx.channelId}`;
    const horizon = this.ctx["yesimbot.horizon"];
    return horizon?.lookupNativeMsgId(channelKey, shortId) ?? null;
  }

  private summarizeSkill(skill: SkillDefinition, status: string) {
    return {
      status,
      name: skill.name,
      description: skill.description,
      guidance: skill.guidance,
      enabledTools: skill.allowedTools ?? [],
      resources: skill.resources
        ? Object.entries(skill.resources).map(([storeKey, reference]) => ({
            storeKey,
            ...reference,
          }))
        : [],
    };
  }

  private async recordSentMessage(entry: {
    platform: string;
    channelId: string;
    messageId: string;
    senderId: string;
    senderName: string;
    content: string;
  }): Promise<void> {
    const horizon = this.ctx["yesimbot.horizon"] as {
      recordMessage?: (data: {
        platform: string;
        channelId: string;
        stage: TimelineStage;
        timestamp: Date;
        data: MessageEventData;
      }) => Promise<unknown>;
      events?: {
        recordMessage?: (data: {
          platform: string;
          channelId: string;
          stage: TimelineStage;
          timestamp: Date;
          data: MessageEventData;
        }) => Promise<unknown>;
      };
    };

    const payload = {
      platform: entry.platform,
      channelId: entry.channelId,
      stage: TimelineStage.Active,
      timestamp: new Date(),
      data: {
        messageId: entry.messageId,
        senderId: entry.senderId,
        senderName: entry.senderName,
        content: entry.content,
      },
    };

    if (typeof horizon.recordMessage === "function") {
      await horizon.recordMessage(payload);
      return;
    }

    if (typeof horizon.events?.recordMessage === "function") {
      await horizon.events.recordMessage(payload);
    }
  }

  @Tool({
    name: "loadSkill",
    description:
      "Explicitly load a registered skill by name. Returns the skill guidance content, enabled tools, and any declared resource references.",
    parameters: withInnerThoughts({
      skillName: Schema.string().required().description("Registered skill name to load"),
    }),
  })
  async loadSkillTool(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const skillName = String(params["skillName"] ?? "").trim();
    if (!skillName) {
      return Failed("skillName is required");
    }

    const catalog = this.ctx["yesimbot.skill"] as SkillRegistry | undefined;
    const sessionStore = this.ctx["yesimbot.session"] as AgentSessionStore | undefined;
    if (!catalog || !sessionStore) {
      return Failed("Skill services unavailable");
    }

    const skill = catalog.get(skillName);
    if (!skill) {
      return Failed(`Skill not found: ${skillName}`);
    }

    const result = sessionStore.loadSkill(ctx.platform, ctx.channelId, skill, "model-tool");
    return Success(this.summarizeSkill(skill, result.status));
  }

  @Tool({
    name: "loadResource",
    description:
      "Read a resource bundled with a registered skill using the format <skill-name>/<store-key>.",
    parameters: withInnerThoughts({
      resourceId: Schema.string()
        .required()
        .description("Resource identifier in the format <skill-name>/<store-key>"),
    }),
  })
  async loadResourceTool(
    params: Record<string, unknown>,
    _ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const resourceId = String(params["resourceId"] ?? "").trim();
    const slashIndex = resourceId.indexOf("/");
    if (!resourceId || slashIndex <= 0 || slashIndex === resourceId.length - 1) {
      return Failed("resourceId must use the format <skill-name>/<store-key>");
    }

    const skillName = resourceId.slice(0, slashIndex);
    const storeKey = resourceId.slice(slashIndex + 1);
    if (storeKey.includes("..")) {
      return Failed("Invalid resource path");
    }

    const catalog = this.ctx["yesimbot.skill"] as SkillRegistry | undefined;
    if (!catalog) {
      return Failed("Skill catalog unavailable");
    }

    const skill = catalog.get(skillName);
    if (!skill) {
      return Failed(`Skill not found: ${skillName}`);
    }

    const reference = skill.resources?.[storeKey];
    if (!reference) {
      return Failed(`Resource not found: ${resourceId}`);
    }

    const resolvedSkillRoot = resolve(skill.rootDir);
    const resolvedPath = resolve(skill.rootDir, reference.path);
    if (resolvedPath !== resolvedSkillRoot && !resolvedPath.startsWith(`${resolvedSkillRoot}/`)) {
      return Failed("Invalid resource path");
    }

    try {
      const content = readFileSync(resolvedPath, "utf-8");
      return Success({
        resourceId,
        skillName,
        storeKey,
        description: reference.description,
        content,
      });
    } catch (error) {
      return Failed(error instanceof Error ? error.message : String(error));
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
    const content = String(params["content"] ?? "");
    try {
      const target = params["target"] as { platform: string; channelId: string } | undefined;
      const replyToStr = params["replyTo"] as string | undefined;

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
        const sentMessages: Array<{
          platform: string;
          channelId: string;
          messageId: string;
          content: string;
        }> = [];
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          const msgContent = effectiveParts[i]!;
          const parsed = filterInteractive(h.parse(msgContent));
          const sentResult = await bot.sendMessage(channelId, parsed);
          const messageIds =
            Array.isArray(sentResult) && sentResult.every((item) => typeof item === "string")
              ? sentResult
              : typeof sentResult === "string"
                ? [sentResult]
                : [Random.id()];

          for (const messageId of messageIds) {
            sentMessages.push({
              platform,
              channelId,
              messageId,
              content: msgContent,
            });

            await this.recordSentMessage({
              platform,
              channelId,
              messageId,
              senderId: bot.selfId,
              senderName: bot.user?.name ?? "Bot",
              content: msgContent,
            });
          }
        }
        return Success({
          status: "sent",
          partCount: sentMessages.length,
          messageId: sentMessages[0]?.messageId,
          content: sentMessages.map((item) => item.content).join("\n"),
          messages: sentMessages,
        });
      } else {
        const sentMessages: Array<{
          platform: string;
          channelId: string;
          messageId: string;
          content: string;
        }> = [];
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          const msgContent = effectiveParts[i]!;
          const parsedContent = h.parse(msgContent);
          const filteredContent = filterInteractive(parsedContent);
          const elements =
            i === 0 && replyToNativeId
              ? [h("quote", { id: replyToNativeId }), ...filteredContent]
              : filteredContent;
          const sentResult = await ctx.session?.send(elements);
          const messageIds =
            Array.isArray(sentResult) && sentResult.every((item) => typeof item === "string")
              ? sentResult
              : typeof sentResult === "string"
                ? [sentResult]
                : [Random.id()];

          for (const messageId of messageIds) {
            sentMessages.push({
              platform: ctx.platform,
              channelId: ctx.channelId,
              messageId,
              content: msgContent,
            });

            await this.recordSentMessage({
              platform: ctx.platform,
              channelId: ctx.channelId,
              messageId,
              senderId: ctx.bot?.selfId ?? "unknown-bot",
              senderName: ctx.bot?.user?.name ?? "Bot",
              content: msgContent,
            });
          }
        }
        return Success({
          status: "sent",
          partCount: sentMessages.length,
          messageId: sentMessages[0]?.messageId,
          content: sentMessages.map((item) => item.content).join("\n"),
          messages: sentMessages,
        });
      }
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}
