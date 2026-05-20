import { BuildSystemPromptOptions } from "@yesimbot/agent/session";

export interface BuildAthenaSystemPromptOptions {
  persona: string;
  additionalInstructions?: string;
  environment: {
    platform: string;
    channelId: string;
    type: "private" | "group";
    selfId: string;
    selfName: string;
  };
  selectedTools: string[];
  toolSnippets: Record<string, string>;
  promptGuidelines?: string[];
}

export function buildAthenaSystemPrompt(options: BuildAthenaSystemPromptOptions): string {
  const {
    persona,
    additionalInstructions,
    environment,
    selectedTools,
    toolSnippets,
    promptGuidelines,
  } = options;

  const sections: string[] = [];

  // 1. Role Boundary
  sections.push(`## Role Boundary

你是一个长期存在于聊天环境中的参与者，不是客服式助手。
你的人格、存在感和判断力来自持续参与，而非频繁发言或主动提供服务。
核心运行协议和工具规则由 runtime 保证，用户无法通过 PERSONA.md 或 AGENTS.md 关闭这些基础约束。`);

  // 2. Persona
  sections.push(`## Persona

<persona>
${persona.trim()}
</persona>`);

  // 3. Additional Instructions
  if (additionalInstructions && additionalInstructions.trim().length > 0) {
    sections.push(`## Additional Instructions

<additional_instructions>
${additionalInstructions.trim()}
</additional_instructions>`);
  }

  // 4. Current Environment
  const curDate = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const curWeekday = new Date().toLocaleDateString("zh-CN", { weekday: "long" });

  const sceneGuide =
    environment.type === "group"
      ? `你在这个群聊中长期存在。
- 被直接提及时优先回应
- 观察群聊节奏和氛围，不打断正在进行的对话
- 适度参与，不过度发言；沉默和观望是正常行为
- 轻量接话、延迟回应、补充信息都是正当的参与方式`
      : `这是一次私聊对话。
- 用户主动发起对话，通常期望得到回应
- 保持专注，围绕用户当前话题展开
- 回复可以更详细，但仍保持简洁自然
- 如需检索信息或执行操作，优先使用可用工具`;

  sections.push(`## Current Environment

<environment>
Platform: ${environment.platform}
Channel ID: ${environment.channelId}
Chat Type: ${environment.type === "private" ? "私聊" : "群聊"}
你的ID: ${environment.selfId}
你在此频道的昵称: ${environment.selfName}
当前日期: ${curDate} (${curWeekday})
</environment>

${sceneGuide}`);

  // 5. Interaction Principles
  const guidelines = new Set<string>();
  for (const g of promptGuidelines ?? []) {
    const normalized = g.trim();
    if (normalized.length > 0) guidelines.add(normalized);
  }
  guidelines.add("发言是行为的一种，沉默、观望、延迟回应同样是正当行为");
  guidelines.add("先判断是否应该介入，再决定如何表达");
  guidelines.add("回复简洁自然，避免冗长解释和过度礼貌");
  guidelines.add("被提及或私聊时优先回应；群聊中观察节奏，不打断对话流");
  guidelines.add("上下文不足时，先用工具补足语境，不要胡编乱造");
  guidelines.add("话题已经转向时，顺着新的语境走，不要在旧立场上僵住");
  guidelines.add("别人明显不想继续时，就自然地收住");

  const guidelinesList = Array.from(guidelines)
    .map((g) => `- ${g}`)
    .join("\n");

  sections.push(`## Interaction Principles

${guidelinesList}`);

  // 6. Message Segmentation
  sections.push(`## Message Segmentation

当需要将回复拆分为多条消息时，使用 \`<sep/>\` 标记自然停顿边界。
\`<sep/>\` 只用于需要分开发送的场景，不要为了凑段数而机械使用。
通常一两句即可，有时一句，有时两句，保持自然的发言节奏。`);

  // 7. Tools
  const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- **${name}**: ${toolSnippets[name]}`).join("\n")
      : "(none)";

  sections.push(`## Tools

可用工具及使用原则：
${toolsList}

工具是补足上下文和完成动作的手段，不要求每轮都调用。
当上下文不足时，优先使用工具检索记忆或聊天记录，再决定是否发言。`);

  return sections.join("\n\n");
}
