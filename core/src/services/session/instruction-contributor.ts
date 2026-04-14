export type InstructionLayer =
  | "identity"
  | "behavior"
  | "environment"
  | "relationship"
  | "extension";

export interface InstructionAssemblyTurnContext {
  messageId: string;
  timestamp: number;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
}

export interface InstructionAssemblyDisplayLabels {
  channel?: string;
  sender?: string;
  replyTarget?: string;
}

export interface InstructionAssemblyMentionFacts {
  atSelf: boolean;
  isReplyToBot: boolean;
}

export interface InstructionAssemblyParticipantSummary {
  senderId: string;
  senderUsername: string;
  senderNickname?: string;
  senderIdentity?: string;
  replyTargetUsername?: string;
}

export interface InstructionAssemblyContext {
  platform: string;
  channelId: string;
  channelType: "private" | "group";
  isDirect: boolean;
  displayLabels: InstructionAssemblyDisplayLabels;
  participantSummary: InstructionAssemblyParticipantSummary;
  mentionFacts: InstructionAssemblyMentionFacts;
  turn: InstructionAssemblyTurnContext;
}

export interface InstructionBlock {
  key: string;
  title: string;
  content: string;
  layer: InstructionLayer;
  priority: number;
}

export interface InstructionContributor {
  name: string;
  shouldApply?(context: InstructionAssemblyContext): boolean | Promise<boolean>;
  collect(context: InstructionAssemblyContext): InstructionBlock[] | Promise<InstructionBlock[]>;
}

const LAYER_ORDER: Record<InstructionLayer, number> = {
  identity: 0,
  behavior: 1,
  environment: 2,
  relationship: 3,
  extension: 4,
};

export function sortInstructionBlocks(blocks: readonly InstructionBlock[]): InstructionBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => {
      const priorityGap = left.block.priority - right.block.priority;
      if (priorityGap !== 0) {
        return priorityGap;
      }

      const layerGap = LAYER_ORDER[left.block.layer] - LAYER_ORDER[right.block.layer];
      if (layerGap !== 0) {
        return layerGap;
      }

      const keyGap = left.block.key.localeCompare(right.block.key);
      if (keyGap !== 0) {
        return keyGap;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.block);
}
