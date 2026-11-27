/** Escape every Unicode code point in a quoted CSS string, including '<'. */
export function cssString(value: string): string {
    return Array.from(value, (character) => `\\${character.codePointAt(0)!.toString(16)} `).join("");
}
export function boundedPixels(value: number, min: number, max: number): number {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error("Invalid rendering dimensions");
    return value;
}
