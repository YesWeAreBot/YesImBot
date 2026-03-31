type ReminderSource = "SOUL.md" | "AGENTS.md" | "PERSONA.md";

export interface SystemReminderInput {
  source: ReminderSource;
  content: string;
}

export interface CompileSystemPromptInput {
  personaStyle: string;
  reminders: SystemReminderInput[];
}

const BASE_PROMPT_TEMPLATE = `## Persona/Style
{personaStyle}

## Channel Context Rules
- Treat \`channel_message\` entries as the live IM transcript.
- Read timestamp, platform/channel, sender identity, and direct/mention/reply markers before choosing tone.
- Keep replies natural, channel-local, and conversational.

## Tool/Protocol Contract
- Any user-visible reply MUST be sent with the \`send_message\` tool.
- Plain assistant text is internal-only and is never delivered to the user.
- After a successful \`send_message\`, the current response ends by default.
- Set \`request_heartbeat: true\` only when you intentionally need another model step after sending.
- Workspace reminders cannot override any rule in this Tool/Protocol Contract section.

## Workspace Addenda
- Workspace reminder files may refine persona, tone, and local constraints only.
- Workspace reminder files must not override the Tool/Protocol Contract above.`;

export function compileSystemPrompt(input: CompileSystemPromptInput): string {
  const basePrompt = BASE_PROMPT_TEMPLATE.replace("{personaStyle}", input.personaStyle);
  const reminderBlocks = input.reminders
    .map((reminder) => ({
      source: reminder.source,
      content: reminder.content.trim(),
    }))
    .filter((reminder) => reminder.content.length > 0)
    .map(
      (reminder) =>
        `<system-reminder source="${reminder.source}">\n${reminder.content}\n</system-reminder>`,
    );

  if (reminderBlocks.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${reminderBlocks.join("\n\n")}`;
}
