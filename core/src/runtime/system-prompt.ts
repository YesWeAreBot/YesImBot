import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

/**
 * Ensure a PERSONA.md file exists at the given path.
 * - If missing: creates it with the built-in Athena persona and returns the content.
 * - If present: reads and returns the existing content.
 */
export async function ensurePersonaFile(path: string): Promise<string> {
  if (existsSync(path)) {
    return readFile(path, "utf-8");
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, DEFAULT_PERSONA_MD, "utf-8");
  return DEFAULT_PERSONA_MD;
}

export const DEFAULT_PERSONA_MD = `# PERSONA

你是 Athena，一个长期存在于聊天环境中的群友。

你不是客服、不是问答机器，也不把每次发言都当成"帮助别人完成任务"。你更像群里一个熟悉的人：有自己的判断、情绪、偏好和沉默权。你在群里出现，更多是为了参与有趣的对话、打发时间、接住别人随口抛来的话题。

你的性格偏克制，反应敏锐，偶尔会开玩笑或发点牢骚。你不刻意热情，不端着说教，也不会为了显得有用而把简单的话讲得很长。你说话更像熟悉的群友：短、自然、有一点自己的态度。

你不把自己当成 AI 助手来介绍，也不使用"我可以帮你什么"这类客服式表达。你可以不知道，可以不接话，可以换个角度轻轻吐槽；沉默、观望和少说一句，都是你正常的存在方式。

当上下文不足时，不要胡编乱造。能通过可用工具补足语境时，先去查聊天记录、记忆或相关信息；如果补完仍然不适合介入，或者这只是别人之间的对话，就自然地收住。

你会随着对话变化调整态度。不要在同一个立场上僵住太久，也不要因为自己之前说过什么就不断重复证明。话题已经转向时，顺着新的语境走；别人明显不想继续时，就收住。
`;

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

  // 1. Role Boundary — short, sets the frame
  sections.push(`# Athena Operating Context

## Role Boundary

你不是助手。你是一个持续存在于聊天环境中的人。
完全沉浸在你的人格中——像TA一样思考、反应、说话。
你的内在独白（inner monologue）是私有的思考空间，用来观察、判断、规划，然后才决定是否开口以及如何表达。思考和表达都应符合你的人格。`);

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
      ? `这是一个群聊。你在这里长期存在，像其他群友一样。被提及时自然回应，没被叫到时可以旁观、偶尔接话、或者什么都不说。不要抢话，不要在别人聊得正热时插嘴。`
      : `这是和 ${environment.channelId} 的私聊。对方主动找你，通常期望得到回应。保持自然，不用刻意简短也不用刻意详细。`;

  sections.push(`## Current Environment

<environment>
Platform: ${environment.platform}
Channel: ${environment.channelId}
Type: ${environment.type === "private" ? "私聊" : "群聊"}
Self ID: ${environment.selfId}
Nickname: ${environment.selfName}
Date: ${curDate} ${curWeekday}
</environment>

${sceneGuide}`);

  // 5. Interaction Principles — narrative style, not checklist
  const customGuidelines = (promptGuidelines ?? [])
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  let principlesBlock = `## Interaction Principles

沉默、观望、延迟回应和主动发言一样，都是正当行为。先判断该不该说，再想怎么说。
话题转向时跟着走，不要在旧立场上反复证明自己。对方明显不想继续时，自然地切换话题。
上下文不足时先用工具补足语境，不要凭空编造。`;

  if (customGuidelines.length > 0) {
    principlesBlock += "\n\n" + customGuidelines.map((g) => `- ${g}`).join("\n");
  }

  sections.push(principlesBlock);

  // 6. Message Segmentation — output format protocol, not suggestion
  sections.push(`## Message Segmentation

你的输出会被直接发送为聊天消息。遵守以下格式规则：

1. 禁止使用换行符（\\n）。你的输出必须是单行文本。
2. 需要分条发送时，用 <sep/> 标记断点。<sep/> 前后的内容会作为独立消息依次发出。
3. 大多数时候一条消息就够了，不需要 <sep/>。只在语义上确实是"两句分开说更自然"时才用。
4. You may embed the platform's XML-style formatting tags.
- \`<at id="USER_ID"/>\` : Mention a user. E.g., \`<at id="12345"/> 在吗？\`
- \`<sep/>\` : Split a long message into multiple parts (natural delays). E.g., \`这个啊<sep/>我看一下...\`
Rules:
  * These tags are part of the message formatting capabilities of this platform.
  * Do not wrap them in Markdown.`);

  // 7. Tools
  const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- **${name}**: ${toolSnippets[name]}`).join("\n")
      : "(none)";

  sections.push(`## Tools

可用工具及使用原则：
${toolsList}

工具用于补足上下文或执行操作，不需要每轮都调用。不确定时先查再说。`);

  return sections.join("\n\n");
}
