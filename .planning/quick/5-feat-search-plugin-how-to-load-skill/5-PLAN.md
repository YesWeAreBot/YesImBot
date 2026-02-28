---
phase: quick
plan: 5
type: execute
wave: 1
depends_on: []
files_modified:
  - plugins/search/src/index.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "SearchPlugin registers a skill with SkillRegistry on initialization"
    - "Skill enables the search tool when activated by conditions"
    - "Skill is disposed when SearchPlugin is disposed"
  artifacts:
    - path: "plugins/search/src/index.ts"
      provides: "Skill registration in SearchPlugin"
      contains: "ctx['yesimbot.skill'].register"
  key_links:
    - from: "SearchPlugin constructor"
      to: "SkillRegistry.register"
      via: "this.ctx['yesimbot.skill'].register()"
      pattern: "register\\(\\{\\s*name:"
---

<objective>
Register a skill in SearchPlugin to enable the search tool through the skill activation system.

Purpose: The SearchPlugin currently registers its tool but doesn't integrate with the skill system. Users should be able to activate search functionality through conditions or traits.

Output: SearchPlugin registers a skill definition that includes the search tool in the tool filter when activated.
</objective>

<execution_context>
@/root/.claude/get-shit-done/workflows/execute-plan.md
@/root/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@core/src/services/skill/service.ts
@core/src/services/skill/types.ts
@plugins/search/src/index.ts
@packages/plugin/src/types.ts

<interfaces>
<!-- From core/src/services/skill/types.ts -->

SkillDefinition structure:

```typescript
interface SkillDefinition {
  name: string;
  description?: string;
  conditions?: ConditionNode; // For declarative activation
  activate?: (signals: TraitSignal[]) => boolean; // For programmatic activation
  lifecycle: "per-turn" | "sticky" | "trait-bound";
  stickyTimeout?: number;
  injectionPoint?: InjectionPoint;
  styleInjectionPoint?: InjectionPoint;
  effects: {
    prompt?: string;
    style?: StyleEffect;
    tools?: { include?: string[]; exclude?: string[] };
  };
  source: "file" | "plugin";
}
```

<!-- From core/src/services/skill/service.ts -->

SkillRegistry.register():

```typescript
register(def: SkillDefinition): () => void;
// Returns a dispose callback that removes the skill
```

TraitSignal structure (from shared/types.ts):

```typescript
interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add skill registration to SearchPlugin</name>
  <files>plugins/search/src/index.ts</files>
  <action>
    In SearchPlugin constructor, after registering the tool, call ctx['yesimbot.skill'].register() with a skill definition:

    1. Create a skill definition named "web-search" with:
       - source: "plugin"
       - lifecycle: "per-turn" (default, activates each turn when conditions match)
       - effects.tools.include: ["search"] (enables the search tool when skill activates)
       - Optional: Add conditions for activation (e.g., when user signals need for information)

    2. Store the returned dispose callback

    3. In the existing dispose hook (line 52-54), call the skill dispose callback to unregister the skill

    Example pattern:
    ```typescript
    const skillDispose = this.ctx['yesimbot.skill'].register({
      name: 'web-search',
      description: 'Enable web search capability',
      lifecycle: 'per-turn',
      effects: {
        tools: { include: ['search'] }
      },
      source: 'plugin'
    });

    // In dispose hook:
    skillDispose();
    ```

    Do NOT add conditions yet - this is a basic integration. Conditions can be added later if needed.

  </action>
  <verify>
    <automated>grep -n "skill.register\|yesimbot.skill" plugins/search/src/index.ts</automated>
  </verify>
  <done>
    SearchPlugin registers a skill with SkillRegistry; skill dispose is called in dispose hook.
  </done>
</task>

</tasks>

<verification>
- Skill registration call exists in SearchPlugin constructor
- Skill dispose is called in the dispose hook
- Tool filter include array contains "search"
</verification>

<success_criteria>
SearchPlugin integrates with skill system - search tool can be controlled through skill activation.
</success_criteria>

<output>
After completion, create `.planning/quick/5-feat-search-plugin-how-to-load-skill/5-SUMMARY.md`
</output>
