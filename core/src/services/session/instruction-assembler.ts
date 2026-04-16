import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  InstructionAssemblyContext,
  InstructionBlock,
  InstructionContributor,
} from "./instruction-contributor";
import { sortInstructionBlocks } from "./instruction-contributor";
import { AGENTS_FILE, PERSONA_FILE, TOOLS_FILE, USER_FILE } from "./instruction-state/layout";
import type { InstructionStateService } from "./instruction-state/service";
import type { ChannelMessageInput } from "./types";

const DEFAULT_SESSION_INSTRUCTIONS =
  "你是一个群聊参与者。像真人一样自然地参与对话，不要使用助手腔调。所有要发送到聊天中的可见内容都必须通过 send_message 工具发送；普通 assistant 文本不会直接发给用户。默认在发送后结束当前轮次，只有在确实需要继续下一步时才设置 request_heartbeat。";

const CORE_RUNTIME_BLOCK_KEY = "core.runtime-environment";

function formatInstructionBlock(block: InstructionBlock): string {
  return `## ${block.title}\n${block.content}`;
}

function readOptionalInstructionFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, "utf8").trim();
  if (!content) {
    return null;
  }

  return content;
}

async function collectContributorBlocks(
  contributors: readonly InstructionContributor[],
  context: InstructionAssemblyContext,
): Promise<InstructionBlock[]> {
  const blocks: InstructionBlock[] = [];

  for (const contributor of contributors) {
    const shouldApply = contributor.shouldApply ? await contributor.shouldApply(context) : true;
    if (!shouldApply) {
      continue;
    }

    const collected = await contributor.collect(context);
    for (const block of collected) {
      blocks.push({
        ...block,
        key: `${contributor.name}.${block.key}`,
      });
    }
  }

  return blocks;
}

function buildRuntimeEnvironmentBlock(context: InstructionAssemblyContext): InstructionBlock {
  const conversationType = context.channelType;
  const visibility = context.isDirect ? "direct/private" : "public/group";
  const channelLabel = context.displayLabels.channel ?? context.channelId;
  const senderLabel =
    context.displayLabels.sender ??
    context.participantSummary.senderNickname ??
    context.participantSummary.senderUsername;
  const replyTarget =
    context.displayLabels.replyTarget ?? context.participantSummary.replyTargetUsername;

  const lines = [
    "[Runtime Environment]",
    `Platform: ${context.platform}`,
    `Conversation type: ${conversationType}`,
    `Conversation visibility: ${visibility}`,
    `Channel label: ${channelLabel}`,
    `Mentioned bot: ${context.mentionFacts.atSelf ? "yes" : "no"}`,
    `Reply-to-bot: ${context.mentionFacts.isReplyToBot ? "yes" : "no"}`,
    `Participant summary: sender=${senderLabel} (${context.participantSummary.senderId})`,
  ];

  if (context.participantSummary.senderIdentity) {
    lines.push(`Participant identity: ${context.participantSummary.senderIdentity}`);
  }

  if (replyTarget) {
    lines.push(`Reply target: ${replyTarget}`);
  }

  return {
    key: CORE_RUNTIME_BLOCK_KEY,
    title: "Runtime Environment",
    content: lines.join("\n"),
    layer: "environment",
    priority: 50,
  };
}

export interface InstructionAssemblerOptions {
  instructionStateService: InstructionStateService;
  getBuiltInInstructions: (fallback: string) => string;
  contributors?: InstructionContributor[];
}

export interface BuildSystemPromptInput {
  platform: string;
  channelId: string;
  turn: ChannelMessageInput;
}

export class InstructionAssembler {
  private readonly instructionStateService: InstructionStateService;
  private readonly getBuiltInInstructions: (fallback: string) => string;
  private readonly contributors: readonly InstructionContributor[];

  constructor(options: InstructionAssemblerOptions) {
    this.instructionStateService = options.instructionStateService;
    this.getBuiltInInstructions = options.getBuiltInInstructions;
    this.contributors = options.contributors ?? [];
  }

  async buildSystemPrompt(input: BuildSystemPromptInput): Promise<string> {
    const context = this.createAssemblyContext(input);
    const blocks: InstructionBlock[] = [];

    const builtIn = this.getBuiltInInstructions(DEFAULT_SESSION_INSTRUCTIONS).trim();
    if (builtIn) {
      blocks.push({
        key: "core.builtin-instructions",
        title: "Core Instructions",
        content: builtIn,
        layer: "behavior",
        priority: 0,
      });
    }

    const globalDir = this.instructionStateService.getGlobalInstructionsDir();
    const scopedDir = input.turn.isDirect
      ? this.instructionStateService.getUserInstructionsDir(
          input.platform,
          input.turn.sender.userId,
        )
      : this.instructionStateService.getChannelInstructionsDir(input.platform, input.channelId);
    const scopedLabel = input.turn.isDirect ? "User" : "Channel";

    const globalPersona = readOptionalInstructionFile(join(globalDir, PERSONA_FILE));
    const globalAgents = readOptionalInstructionFile(join(globalDir, AGENTS_FILE));
    const globalTools = readOptionalInstructionFile(join(globalDir, TOOLS_FILE));
    const scopedPersona = readOptionalInstructionFile(join(scopedDir, PERSONA_FILE));
    const scopedAgents = readOptionalInstructionFile(join(scopedDir, AGENTS_FILE));
    const scopedTools = readOptionalInstructionFile(join(scopedDir, TOOLS_FILE));

    if (globalPersona) {
      blocks.push({
        key: "global.persona",
        title: `Global ${PERSONA_FILE}`,
        content: globalPersona,
        layer: "identity",
        priority: 10,
      });
    }

    if (globalAgents) {
      blocks.push({
        key: "global.agents",
        title: `Global ${AGENTS_FILE}`,
        content: globalAgents,
        layer: "behavior",
        priority: 10,
      });
    }

    if (globalTools) {
      blocks.push({
        key: "global.tools",
        title: `Global ${TOOLS_FILE}`,
        content: globalTools,
        layer: "environment",
        priority: 10,
      });
    }

    if (scopedPersona) {
      blocks.push({
        key: "state.persona",
        title: `${scopedLabel} ${PERSONA_FILE}`,
        content: scopedPersona,
        layer: "identity",
        priority: 20,
      });
    }

    if (scopedAgents) {
      blocks.push({
        key: "state.agents",
        title: `${scopedLabel} ${AGENTS_FILE}`,
        content: scopedAgents,
        layer: "behavior",
        priority: 20,
      });
    }

    if (scopedTools) {
      blocks.push({
        key: "state.tools",
        title: `${scopedLabel} ${TOOLS_FILE}`,
        content: scopedTools,
        layer: "environment",
        priority: 20,
      });
    }

    const runtimeEnvironmentBlock = buildRuntimeEnvironmentBlock(context);

    const trailingBlocks: InstructionBlock[] = [];

    if (input.turn.isDirect) {
      const userInstruction = readOptionalInstructionFile(join(scopedDir, USER_FILE));
      if (userInstruction) {
        trailingBlocks.push({
          key: "user.user",
          title: `User ${USER_FILE}`,
          content: userInstruction,
          layer: "relationship",
          priority: 10,
        });
      }
    }

    const contributorBlocks = sortInstructionBlocks(
      await collectContributorBlocks(this.contributors, context),
    );
    trailingBlocks.push(...contributorBlocks);

    return [...blocks, runtimeEnvironmentBlock, ...trailingBlocks]
      .map(formatInstructionBlock)
      .join("\n\n");
  }

  private createAssemblyContext(input: BuildSystemPromptInput): InstructionAssemblyContext {
    const senderLabel = input.turn.sender.nickname ?? input.turn.sender.username;
    const replyTargetLabel = input.turn.replyTo?.nickname ?? input.turn.replyTo?.username;

    return {
      platform: input.platform,
      channelId: input.channelId,
      channelType: input.turn.isDirect ? "private" : "group",
      isDirect: input.turn.isDirect,
      displayLabels: {
        channel: input.channelId,
        sender: senderLabel,
        replyTarget: replyTargetLabel,
      },
      participantSummary: {
        senderId: input.turn.sender.userId,
        senderUsername: input.turn.sender.username,
        senderNickname: input.turn.sender.nickname,
        senderIdentity: input.turn.sender.identity,
        replyTargetUsername: input.turn.replyTo?.username,
      },
      mentionFacts: {
        atSelf: input.turn.atSelf,
        isReplyToBot: input.turn.isReplyToBot,
      },
      turn: {
        messageId: input.turn.messageId,
        timestamp: input.turn.timestamp,
        isDirect: input.turn.isDirect,
        atSelf: input.turn.atSelf,
        isReplyToBot: input.turn.isReplyToBot,
      },
    };
  }
}
