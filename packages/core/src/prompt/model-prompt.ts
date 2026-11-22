import type { Message } from "@xsai/shared-chat";

interface PromptModelMember {
    name: string;
    id: string;
    selected: boolean;
}

export interface PromptModel {
    name: string;
    id: string;
    group: { name: string; models: PromptModelMember[] };
}

export const systemPromptRenderers = new WeakMap<Message, (model: PromptModel) => string>();
