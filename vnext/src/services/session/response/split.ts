const SOFT_BOUNDARY_REGEX = /\n\n|\n/g;

export function computeSegmentDelay(partLength: number): number {
  return Math.max(150, Math.min(1200, 150 + 0.8 * partLength));
}

export function splitVisibleText(text: string, maxChars = 1800): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const parts: string[] = [];
  const chunks = normalized.split(SOFT_BOUNDARY_REGEX).map((chunk) => chunk.trim());

  let current = "";
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (!current) {
      if (chunk.length <= maxChars) {
        current = chunk;
      } else {
        pushHardWrapped(parts, chunk, maxChars);
      }
      continue;
    }

    const joined = `${current}\n${chunk}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }

    parts.push(current);
    if (chunk.length <= maxChars) {
      current = chunk;
    } else {
      pushHardWrapped(parts, chunk, maxChars);
      current = "";
    }
  }

  if (current) parts.push(current);
  return parts;
}

function pushHardWrapped(parts: string[], value: string, maxChars: number): void {
  for (let i = 0; i < value.length; i += maxChars) {
    const piece = value.slice(i, i + maxChars).trim();
    if (piece) parts.push(piece);
  }
}
