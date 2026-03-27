/**
 * Extract outbound message segments from model output text.
 *
 * Per D-10: Only content wrapped in <message>...</message> tags is sent to the channel.
 * Per D-12: <sep/> within a message splits it into multiple outbound messages.
 * Per D-15: Full model output (including reasoning) stays in session; only tagged content is emitted.
 *
 * Returns an array of message strings. Empty array if no <message> tags found.
 */
export function extractMessages(text: string): string[] {
  const messageRegex = /<message>([\s\S]*?)<\/message>/g;
  const segments: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = messageRegex.exec(text)) !== null) {
    const inner = match[1]?.trim();
    if (!inner) {
      continue;
    }

    const parts = inner.split(/<sep\s*\/?>/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
    }
  }

  return segments;
}
