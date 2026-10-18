// Unit tests must supply their own HTTP fixtures. Never send model payloads or
// error reports to real services when a failure path uses default settings.
// Install the baseline directly: vi.unstubAllGlobals() must restore this safe
// function rather than Node's real fetch between cases in the same test file.
globalThis.fetch = async () => {
    throw new Error("Real HTTP requests are disabled in unit tests; mock fetch explicitly");
};
