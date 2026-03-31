import { describe, expect, it } from "vitest";

import { compileSystemPrompt } from "../../src/services/session/prompt/system-prompt";

describe("compileSystemPrompt", () => {
  it("exact base section order", () => {
    const prompt = compileSystemPrompt({
      personaStyle: "persona line",
      reminders: [],
    });

    const personaIdx = prompt.indexOf("## Persona/Style");
    const contextIdx = prompt.indexOf("## Channel Context Rules");
    const protocolIdx = prompt.indexOf("## Tool/Protocol Contract");
    const addendaIdx = prompt.indexOf("## Workspace Addenda");

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeGreaterThan(personaIdx);
    expect(protocolIdx).toBeGreaterThan(contextIdx);
    expect(addendaIdx).toBeGreaterThan(protocolIdx);
  });

  it("includes exact protocol contract lines", () => {
    const prompt = compileSystemPrompt({
      personaStyle: "persona line",
      reminders: [],
    });

    expect(prompt).toContain("- Any user-visible reply MUST be sent with the `send_message` tool.");
    expect(prompt).toContain(
      "- Plain assistant text is internal-only and is never delivered to the user.",
    );
    expect(prompt).toContain(
      "- After a successful `send_message`, the current response ends by default.",
    );
    expect(prompt).toContain(
      "- Set `request_heartbeat: true` only when you intentionally need another model step after sending.",
    );
    expect(prompt).toContain(
      "- Workspace reminders cannot override any rule in this Tool/Protocol Contract section.",
    );
  });

  it("reminder blocks appearing after the base prompt", () => {
    const prompt = compileSystemPrompt({
      personaStyle: "persona line",
      reminders: [
        { source: "SOUL.md", content: " soul  " },
        { source: "AGENTS.md", content: "agents" },
      ],
    });

    const addendaIdx = prompt.indexOf("## Workspace Addenda");
    const soulIdx = prompt.indexOf('<system-reminder source="SOUL.md">');
    const agentsIdx = prompt.indexOf('<system-reminder source="AGENTS.md">');

    expect(soulIdx).toBeGreaterThan(addendaIdx);
    expect(agentsIdx).toBeGreaterThan(soulIdx);
    expect(prompt).toContain('<system-reminder source="SOUL.md">\nsoul\n</system-reminder>');
  });

  it("skips empty reminder blocks", () => {
    const prompt = compileSystemPrompt({
      personaStyle: "persona line",
      reminders: [
        { source: "SOUL.md", content: "   " },
        { source: "AGENTS.md", content: "agents" },
      ],
    });

    expect(prompt).not.toContain('<system-reminder source="SOUL.md">');
    expect(prompt).toContain('<system-reminder source="AGENTS.md">');
  });
});
