import { expect, it } from "vitest";

import { cssString, boundedPixels } from "../src/css-safety";
it("cannot close a style tag or CSS string through font data", () => {
    const encoded = cssString('font";}</style><script>fetch("file:///secret")</script>');
    expect(encoded).not.toContain("<");
    expect(encoded).not.toContain('"');
    expect(encoded).not.toContain("}");
    expect(encoded).toContain(String.fromCharCode(92) + "3c ");
});
it.each([NaN, Infinity, -1, 99999])("rejects nonfinite or excessive rendering dimensions %s", (value) => {
    expect(() => boundedPixels(value, 1, 256)).toThrow("dimensions");
});
