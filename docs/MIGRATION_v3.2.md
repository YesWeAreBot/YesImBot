# v3.2 Runtime Context Migration Guide

This guide maps deprecated v3.1 runtime APIs to canonical v3.2 contracts.

## Migration

Use this guide as a direct old-to-new mapping checklist while upgrading custom plugins, hooks, and runtime consumers.

## Overview

| Old API                                     | New API                                              | Removed In |
| ------------------------------------------- | ---------------------------------------------------- | ---------- |
| `PromptService.inject()`                    | `registerFragmentSource()`                           | Phase 60   |
| `Activator` helpers                         | `requiredCapabilities`                               | Phase 60   |
| `SkillRegistry.resolve()`                   | `loadSkill()` + `SkillEffectApplier`                 | Phase 60   |
| `HorizonView` (external consumers)          | `Scenario` (`RoundContext.snapshot.scenario`)        | Phase 60   |
| `injection_point` / `style_injection_point` | `prompt_fragment.section` / `style_fragment.section` | Phase 60   |

## Prompt Injection

### Before (deprecated)

```ts
promptService.inject(ctx, "soul", {
  name: "my-plugin",
  renderFn: async () => "plugin content",
});
```

### After (canonical)

```ts
promptService.registerFragmentSource("my-plugin", async () => [
  {
    id: "my-plugin.identity",
    section: "identity",
    source: "hook",
    stability: "dynamic",
    priority: 500,
    content: "plugin content",
  },
]);
```

### Section mapping reference

```ts
// legacy -> canonical
"soul" -> "identity"
"instructions" -> "policy"
"extra" -> "situation"
```

## Activators

### Before (deprecated)

```ts
defineTool({
  name: "send_message",
  activators: [requireSession(), requirePlatform("onebot")],
  handler,
});
```

### After (canonical)

```ts
defineTool({
  name: "send_message",
  requiredCapabilities: ["platform.session", "message.send"],
  handler,
});
```

### Capability key reference

| Key                    | Meaning                   |
| ---------------------- | ------------------------- |
| `message.send`         | Send messages             |
| `message.reply`        | Reply to a message        |
| `message.delete`       | Delete messages           |
| `message.read_history` | Read channel history      |
| `message.direct`       | Send direct messages      |
| `member.moderate`      | Moderate members          |
| `social.essence`       | Essence/pin operations    |
| `social.reaction`      | Reaction operations       |
| `platform.session`     | Runtime session available |

## Skill Activation

### Before (deprecated)

```ts
const effect = skillRegistry.resolve(signals, key);
const prompts = effect.promptInjections;
const style = effect.styleOverride;
```

### After (canonical)

```ts
await hookCtx.loadSkill("answering");
const loaded = hookCtx.getLoadedSkills();
const applied = new SkillEffectApplier().apply(new LoadedSkillSet(loaded));
const prompts = applied.promptFragments;
const style = applied.styleFragment;
```

### Agent-start mutation note

```ts
// legacy mutation path (deprecated and ignored)
params.skills = [{ name: "x", effects: [] }];

// canonical path
await params.loadSkill("x");
```

## HorizonView

### Field mapping

| `HorizonView`                | `Scenario`                                              |
| ---------------------------- | ------------------------------------------------------- |
| `view.self.name`             | `scenario.raw.self.name`                                |
| `view.self.id`               | `scenario.raw.self.id`                                  |
| `view.self.role`             | `scenario.raw.self.role`                                |
| `view.environment.type`      | `scenario.raw.environment.type`                         |
| `view.environment.platform`  | `scenario.raw.environment.platform`                     |
| `view.environment.channelId` | `scenario.raw.environment.channelId`                    |
| `view.history`               | `scenario.raw.scenarioTimeline.turns[].messages/events` |

### Before (deprecated consumer)

```ts
detect(key, view) {
  const botName = view.self?.name;
  const isPrivate = view.environment?.type === "private";
}
```

### After (canonical consumer)

```ts
detect(key, scenario) {
  const botName = scenario.raw.self.name;
  const isPrivate = scenario.raw.environment.type === "private";
}
```

### Prompt scope before/after

```ts
// before
promptScope = { view, percept, ... };

// after
promptScope = { percept, roundContext, scenario, capabilities };
```

## Skill YAML

### Before (deprecated)

```yaml
effects:
  prompt: "..."
  injection_point: instructions
  style: "..."
  style_injection_point: instructions
```

### After (canonical)

```yaml
effects:
  prompt: "..."
  prompt_fragment:
    section: policy
  style: "..."
  style_fragment:
    section: policy
```

## Hook Context

### Before (deprecated)

```ts
type HookContext<T> = {
  params: T;
  // implicit skill resolution side effects
};
```

### After (canonical)

```ts
type AgentStartHookExecutionContext = {
  roundContext: RoundContext;
  scenario: Scenario;
  capabilities: Capabilities;
  loadSkill(skillName: string): Promise<LoadResult>;
  getLoadedSkills(): SkillDefinition[];
};
```

## ToolExecutionContext Changes

### Before

```ts
type ToolExecutionContext = {
  platform: string;
  channelId: string;
  view?: HorizonView;
};
```

### After

```ts
type ToolExecutionContext = {
  platform: string;
  channelId: string;
  roundContext?: RoundContext;
  scenario?: Scenario;
  capabilities?: Capabilities;
};
```

## FragmentSource Changes

### Before

```ts
type FragmentSource = "role" | "memory" | "scenario" | "legacy" | ...;
```

### After

```ts
type FragmentSource = "role" | "memory" | "scenario" | "capability" | "skill" | "hook" | "tooling";
```
