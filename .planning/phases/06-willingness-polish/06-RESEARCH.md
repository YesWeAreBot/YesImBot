# Phase 6: Willingness & Polish - Research

**Researched:** 2026-02-19
**Domain:** Reply decision-making (willingness system), reply delay, error handling polish
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**回复决策架构**

- 统一评分系统：所有触发类型（@mention、reply、keyword、random）走同一套评分流程
- 双层架构：规则初筛 + LLM 精判
- 规则层：多因子轻量评分（触发类型权重 + 冷却衰减 + 消息长度/频率等简单信号），类似 v3 但精简
- 双阈值衔接：规则层输出 0-1 分数，低于下限直接拒绝，高于上限直接通过，中间模糊地带交给 LLM 判断

**LLM 意愿判断**

- 可配置模型：默认用轻量模型（如 deepseek-chat），允许用户指定意愿判断专用模型
- 仅模糊地带调用：规则层明确拒绝/通过的不走 LLM，只有模糊地带才调用，控制成本
- 二值输出：LLM 输出 yes/no，不需要分数或理由
- 上下文：触发消息 + 话题摘要（非完整历史），平衡信息量和 token 消耗

**自然感表现**

- 硬冷却 + 软衰减：硬冷却防止连续回复，软衰减控制整体频率
- 冷却双条件：消息条数 + 时间，取较长者（适应不同活跃度的群聊）
- 确定性触发穿透冷却：@mention 和 reply 无视冷却直接回复（为未来日程系统预留接口）
- 回复延迟：长度相关延迟 + 考虑推理耗时的动态调整，保持对话节奏自然
- 消息拆分：LLM 通过多次 send_message 工具调用自主决定拆分，多条消息间加延迟模拟打字间隔

**错误处理策略**

- 用户侧静默失败：API 调用失败时不向用户发送错误消息
- 重试 + fallback：利用 ModelService 已有的 fallback chain，自动重试后尝试备用模型
- 工具失败 LLM 自主处理：工具执行错误信息传回 LLM，由其决定重试或换方式
- 日志 + 可选频道上报：默认用 Koishi logger 记录，配置了上报频道 ID 则同时发送错误摘要

### Claude's Discretion

- 规则层具体因子权重和阈值数值
- LLM 意愿判断的 prompt 设计
- 回复延迟的具体算法和参数
- 消息间延迟的具体时间范围
- 错误重试的退避策略和次数

### Deferred Ideas (OUT OF SCOPE)

- 日记系统 + 自我反思能力：LLM 输出关键词和相关概念，构建知识图谱作为长期记忆引擎
- 日程系统：配置不同时间段/状态下的响应规则，模拟真实在线/离线行为
- 主动浏览行为：agent 主动翻阅聊天记录，找感兴趣的话题参与
- 兴趣与内容挂钩：基于知识库的真正兴趣匹配，而非随机数模拟

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                    | Research Support                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENT-02 | 混合回复决策 — 规则引擎快速筛选 + LLM 精细判断，WillingnessCalculator 为纯算法，IM 属性通过 Percept 元数据传入 | Rule scoring uses triggerType from UserMessagePercept; cooldown state in in-memory Map; LLM judgment via ModelService.getModel() + generateText; all wired into AgentCore.handlePercept() before enqueue |

</phase_requirements>

---

## Summary

Phase 6 adds a `WillingnessCalculator` class that gates every `horizon/percept` event before it reaches the think-act loop. The calculator is pure algorithmic — it receives a `UserMessagePercept` (which already carries `triggerType`, `scope`, `payload`) and returns a decision. No new Koishi services are needed; the calculator lives inside `AgentCore` and uses in-memory Maps for cooldown state.

The dual-threshold architecture maps cleanly to the existing flow: `AgentCore.handlePercept()` currently calls `enqueue()` unconditionally. Phase 6 inserts a `shouldReply()` check before that call. The LLM judgment path uses `ModelService.getModel()` + ai-sdk `generateText` directly (no tools, no loop) — the same pattern already used in `ThinkActLoop`. The willingness model is a separate configurable field in `AgentCoreConfig`.

Error handling polish is additive: `runLoop()` already catches errors and logs them. Phase 6 adds optional channel reporting by calling `ctx.bots` to send a summary when `errorReportChannel` is configured. Reply delay is implemented in `send_message` builtin — after the loop completes, a pre-send delay is applied based on message length.

**Primary recommendation:** Add `WillingnessCalculator` as a plain class (not a Service) inside `services/agent/`, wire it into `AgentCore.handlePercept()`, and extend `AgentCoreConfig` with willingness + error reporting fields.

---

## Standard Stack

### Core

| Library     | Version            | Purpose                                                | Why Standard                                         |
| ----------- | ------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| ai (ai-sdk) | 6.0.90 (installed) | LLM willingness judgment via generateText              | Already used in ThinkActLoop; same pattern, no tools |
| koishi      | ^4.18.3            | ctx.setTimeout for delay, ctx.bots for error reporting | Project framework                                    |

### Supporting

| Library        | Version  | Purpose                                | When to Use                  |
| -------------- | -------- | -------------------------------------- | ---------------------------- |
| koishi `sleep` | built-in | Reply delay between send_message parts | Already imported in index.ts |

No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure

```
plugins/core/src/services/agent/
├── config.ts          # extend AgentCoreConfig with willingness + error fields
├── service.ts         # AgentCore — insert shouldReply() before enqueue()
├── loop.ts            # ThinkActLoop — add pre-send delay in send_message path
├── tools.ts           # unchanged
├── willingness.ts     # WillingnessCalculator — pure class, no Service
└── index.ts           # re-export WillingnessCalculator if needed
```

### Pattern 1: WillingnessCalculator as Pure Class

**What:** A stateful class (not a Koishi Service) that holds per-channel cooldown Maps and exposes a single async `shouldReply(percept, config)` method.

**When to use:** Called from `AgentCore.handlePercept()` before `enqueue()`.

```typescript
// Source: codebase analysis — UserMessagePercept already has triggerType
interface CooldownState {
  lastReplyAt: number; // timestamp ms
  messagesSinceReply: number; // count since last bot reply
}

export class WillingnessCalculator {
  private cooldowns = new Map<string, CooldownState>();

  async shouldReply(
    percept: UserMessagePercept,
    config: WillingnessConfig,
    modelService: ModelService,
  ): Promise<boolean> {
    const key = `${percept.scope.platform}:${percept.scope.channelId}`;

    // Deterministic triggers bypass all checks
    if (percept.triggerType === "mention" || percept.triggerType === "reply") {
      return true;
    }

    // Hard cooldown check
    if (this.isInHardCooldown(key, config)) return false;

    // Rule score
    const score = this.computeScore(percept, key, config);

    if (score < config.rejectThreshold) return false;
    if (score >= config.acceptThreshold) return true;

    // Fuzzy zone — LLM judgment
    return this.llmJudge(percept, config, modelService);
  }
}
```

### Pattern 2: Rule Score Computation

**What:** Multi-factor 0-1 score. Trigger type weight is the dominant factor; cooldown decay and message signals are modifiers.

**Recommended weights (Claude's discretion):**

| Factor                   | Value          | Rationale                           |
| ------------------------ | -------------- | ----------------------------------- |
| triggerType: direct      | 0.9            | Private chat, high expectation      |
| triggerType: keyword     | 0.6            | Explicit interest signal            |
| triggerType: random      | 0.2            | Base random participation           |
| Hard cooldown (messages) | default 3 msgs | Prevent consecutive replies         |
| Hard cooldown (time)     | default 60s    | Minimum gap                         |
| Soft decay multiplier    | 0.5–1.0        | Reduces score when recently replied |
| rejectThreshold          | 0.15           | Below this: always reject           |
| acceptThreshold          | 0.75           | Above this: always accept           |

```typescript
// Source: codebase analysis — triggerType from UserMessagePercept
private computeScore(
  percept: UserMessagePercept,
  key: string,
  config: WillingnessConfig,
): number {
  const triggerWeights: Record<TriggerType, number> = {
    mention: 1.0,  // handled before this point
    reply: 1.0,    // handled before this point
    direct: 0.9,
    keyword: 0.6,
    random: 0.2,
  };
  let score = triggerWeights[percept.triggerType] ?? 0.2;

  // Soft decay: reduce score based on time since last reply
  const state = this.cooldowns.get(key);
  if (state) {
    const elapsedMs = Date.now() - state.lastReplyAt;
    const decayFactor = Math.min(1, elapsedMs / (config.softDecayMs ?? 300_000));
    score *= 0.5 + 0.5 * decayFactor; // 50% floor, recovers over softDecayMs
  }

  return score;
}
```

### Pattern 3: Hard Cooldown (Dual Condition)

**What:** Block reply if EITHER condition is unmet: fewer than N messages since last reply AND less than T seconds elapsed. Both must be satisfied to exit cooldown.

```typescript
// Source: design decision — "取较长者" means both conditions must pass
private isInHardCooldown(key: string, config: WillingnessConfig): boolean {
  const state = this.cooldowns.get(key);
  if (!state) return false;
  const msgOk = state.messagesSinceReply >= (config.cooldownMessages ?? 3);
  const timeOk = Date.now() - state.lastReplyAt >= (config.cooldownMs ?? 60_000);
  return !(msgOk && timeOk); // in cooldown if either condition not met
}
```

**Cooldown state update:** Called from `AgentCore` after a successful loop run.

```typescript
// In AgentCore, after runLoop() completes:
this.willingness.recordReply(channelKey);

// In WillingnessCalculator:
recordReply(key: string): void {
  this.cooldowns.set(key, { lastReplyAt: Date.now(), messagesSinceReply: 0 });
}

// On every incoming message (before shouldReply):
incrementMessageCount(key: string): void {
  const state = this.cooldowns.get(key);
  if (state) state.messagesSinceReply++;
}
```

### Pattern 4: LLM Willingness Judgment

**What:** Simple `generateText` call with no tools. Uses `ModelService.getModel()` to get the configured willingness model. Returns `true` if response starts with "yes".

```typescript
// Source: ModelService.getModel() already exists in service.ts line 136
// Source: ai-sdk generateText — same import already in loop.ts
import { generateText } from "ai";

private async llmJudge(
  percept: UserMessagePercept,
  config: WillingnessConfig,
  modelService: ModelService,
): Promise<boolean> {
  const provider = config.willingnessProvider ?? config.provider;
  const model = config.willingnessModel ?? config.model;
  if (!provider || !model) return false;

  try {
    const { model: llmModel, defaultParams } = modelService.getModel(provider, model);
    const { text } = await generateText({
      model: llmModel,
      ...defaultParams,
      system: "You decide if a chatbot should reply. Answer only 'yes' or 'no'.",
      prompt: buildWillingnessPrompt(percept),
      maxTokens: 5,
    });
    return text.trim().toLowerCase().startsWith("yes");
  } catch {
    return false; // fail-safe: don't reply on LLM error
  }
}

function buildWillingnessPrompt(percept: UserMessagePercept): string {
  return `Message: "${percept.payload.content}"\nTrigger: ${percept.triggerType}\nShould the bot join this conversation?`;
}
```

**Key insight:** `maxTokens: 5` keeps cost near zero. No history needed — trigger message + type is sufficient context per the decision.

### Pattern 5: Reply Delay

**What:** Before sending each message part in `send_message`, sleep for a duration proportional to message length. Subtract elapsed LLM inference time to avoid over-delaying.

**Where to implement:** In `CorePlugin.sendMessage()` in `send-message.ts`, or in `ThinkActLoop` after the loop completes. The loop approach is simpler since it has access to elapsed time.

```typescript
// Source: koishi sleep already imported in index.ts
import { sleep } from "koishi";

// Typing delay per character: ~50ms, capped at 3s per part
function typingDelay(content: string): number {
  return Math.min(content.length * 50, 3000);
}

// In send_message execute, before each ctx.session?.send(part):
const delay = typingDelay(part);
if (delay > 0) await sleep(delay);
```

**Between-parts delay (message splitting):** When `<sep/>` splits into multiple parts, add a fixed 800–1500ms gap between parts to simulate typing a new message.

### Pattern 6: Error Reporting Channel

**What:** When `errorReportChannel` is configured, send a brief error summary to that channel after catching an error in `runLoop()`.

```typescript
// Source: CorePlugin.sendMessage already uses ctx.bots.find() — same pattern
private async reportError(err: unknown, percept: Percept): Promise<void> {
  const channel = this.config.errorReportChannel;
  if (!channel) return;
  const [platform, channelId] = channel.split(":");
  const bot = this.ctx.bots.find((b) => b.platform === platform);
  if (!bot) return;
  const summary = `[Error] ${percept.scope.channelId}: ${err instanceof Error ? err.message : String(err)}`;
  await bot.sendMessage(channelId, summary).catch(() => {});
}
```

### Anti-Patterns to Avoid

- **WillingnessCalculator as a Koishi Service:** It has no async init, no lifecycle, no service dependencies. A plain class is correct.
- **Storing cooldown state in the database:** In-memory Map is sufficient. Cooldown state is ephemeral — losing it on restart is acceptable.
- **Calling LLM for mention/reply triggers:** These are deterministic — bypass all scoring and LLM calls entirely.
- **Blocking `handlePercept()` with async willingness check:** `handlePercept()` must remain synchronous in its outer form. The async willingness check should be awaited inside `enqueue()` or a new async gate method, not in the synchronous event handler.

---

## Don't Hand-Roll

| Problem                  | Don't Build        | Use Instead                                | Why                                                   |
| ------------------------ | ------------------ | ------------------------------------------ | ----------------------------------------------------- |
| LLM call for willingness | Custom HTTP client | `ModelService.getModel()` + `generateText` | Already handles provider abstraction, fallback chains |
| Typing delay             | Custom timer logic | `koishi sleep`                             | Already imported, handles cleanup on dispose          |
| Error channel reporting  | Custom bot lookup  | `ctx.bots.find()`                          | Same pattern as send_message builtin                  |
| Cooldown persistence     | Database table     | In-memory Map                              | Ephemeral state, restart reset is acceptable          |

---

## Common Pitfalls

### Pitfall 1: Async shouldReply in Synchronous handlePercept

**What goes wrong:** `handlePercept()` is called from `ctx.on("horizon/percept", ...)` which is synchronous. If `shouldReply()` is awaited there, the event handler becomes async and errors are silently swallowed.

**Why it happens:** The willingness check is async (LLM call), but the event handler signature is `(percept: Percept) => void`.

**How to avoid:** Move the async gate inside `enqueue()` or create an async `gateAndEnqueue()` method that is called from `handlePercept()` without awaiting (fire-and-forget with internal error handling).

```typescript
private handlePercept(percept: Percept): void {
  void this.gateAndEnqueue(percept); // fire-and-forget
}

private async gateAndEnqueue(percept: Percept): Promise<void> {
  try {
    const allowed = await this.willingness.shouldReply(percept as UserMessagePercept, ...);
    if (!allowed) return;
    // increment message count before deciding
    this.enqueue(channelKey, percept);
  } catch (err) {
    this.logger.error(`willingness check failed: ${err}`);
  }
}
```

### Pitfall 2: Message Count Not Incremented for Rejected Messages

**What goes wrong:** If `incrementMessageCount()` is only called when the bot replies, the cooldown counter never advances and the bot stays silent forever after one reply.

**Why it happens:** Cooldown exit requires N messages since last reply — those messages must be counted regardless of whether the bot replies.

**How to avoid:** Call `incrementMessageCount(channelKey)` at the start of `gateAndEnqueue()`, before the willingness check.

### Pitfall 3: LLM Willingness Model Falls Back to Main Model

**What goes wrong:** If `willingnessProvider`/`willingnessModel` are not configured, the willingness check uses the main agent model — expensive and slow.

**Why it happens:** Fallback to `config.provider`/`config.model` without warning.

**How to avoid:** Log a warning when willingness LLM is triggered but no dedicated model is configured. Default to `false` (reject) if no model is available rather than using the main model.

### Pitfall 4: Reply Delay Doubles Perceived Latency

**What goes wrong:** Adding a typing delay on top of LLM inference time makes the bot feel very slow, especially for short messages where inference already took 2–3s.

**Why it happens:** Delay is applied unconditionally without accounting for elapsed time.

**How to avoid:** Track `loopStartTime` in `ThinkActLoop.run()`. After the loop, compute `elapsed = Date.now() - loopStartTime`. Apply `Math.max(0, typingDelay - elapsed)` as the actual sleep duration.

### Pitfall 5: Error Reporting Channel Causes Infinite Loop

**What goes wrong:** If the error reporting channel is the same as an allowed channel, a bot error triggers a report message, which triggers a percept, which may trigger another error, etc.

**Why it happens:** Error report messages are sent via `bot.sendMessage()` which triggers `after-send` and potentially `horizon/percept`.

**How to avoid:** The `after-send` handler in `listener.ts` already checks `isChannelAllowed()`. As long as the error report channel is not in `allowedChannels`, this is safe. Document this constraint in config schema description.

---

## Code Examples

### Verified: ModelService.getModel() for willingness LLM call

```typescript
// Source: plugins/core/src/services/model/service.ts line 136
// Already used in loop.ts line 52
const { model, defaultParams } = modelService.getModel(provider, modelId);
const { text } = await generateText({
  model,
  ...defaultParams,
  system: "...",
  prompt: "...",
  maxTokens: 5,
});
```

### Verified: triggerType already on UserMessagePercept

```typescript
// Source: plugins/core/src/services/horizon/types.ts line 116-117
export type TriggerType = "mention" | "reply" | "keyword" | "random" | "direct";
// UserMessagePercept.triggerType: TriggerType — set by listener.ts classifyTrigger()
```

### Verified: ctx.bots.find() pattern for channel reporting

```typescript
// Source: plugins/core/src/services/plugin/builtin/send-message.ts line 38
const bot = this.ctx.bots.find((b) => b.platform === platform);
if (!bot) return Failed(`Bot not found for platform: ${platform}`);
await bot.sendMessage(channelId, content);
```

### Verified: koishi sleep import

```typescript
// Source: plugins/core/src/index.ts line 1
import { Context, Schema, sleep } from "koishi";
// sleep(ms: number): Promise<void> — built into koishi
```

### Verified: AgentCore.handlePercept() is the correct insertion point

```typescript
// Source: plugins/core/src/services/agent/service.ts line 32-39
private handlePercept(percept: Percept): void {
  const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
  if (this.queues.has(channelKey)) {
    this.pending.set(channelKey, percept);
  } else {
    this.enqueue(channelKey, percept);  // <-- willingness gate goes before this
  }
}
```

---

## State of the Art

| Old Approach                                                         | Current Approach                                                                              | Impact                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| v3: WillingnessManager as stateful service with decay interval timer | v4: WillingnessCalculator as plain class, no timer — decay computed on-demand from timestamps | Simpler, no background timer to manage     |
| v3: probability roll (random number vs threshold)                    | v4: dual-threshold with LLM for fuzzy zone                                                    | Eliminates content-disconnected randomness |
| v2: LLM outputs `nextReplyIn` count                                  | v4: hard cooldown (messages + time) + soft decay                                              | More predictable, no LLM cost for cooldown |

---

## Open Questions

1. **Where exactly to apply reply delay**
   - What we know: Delay should be proportional to message length, accounting for inference time
   - What's unclear: Whether delay belongs in `send_message` builtin (per-part) or in `ThinkActLoop` (post-loop)
   - Recommendation: Apply in `ThinkActLoop.run()` after the loop completes, before the fallback send. For `send_message` tool calls, the delay is already "natural" since the LLM call itself takes time. Add inter-part delay (800ms) in `send_message` for `<sep/>` splits only.

2. **Willingness config location**
   - What we know: `AgentCoreConfig` is the natural home; willingness is part of agent behavior
   - What's unclear: Whether to nest under a `willingness` sub-object or flatten
   - Recommendation: Flatten into `AgentCoreConfig` with `willingness` prefix (e.g., `willingnessProvider`, `cooldownMessages`) to match existing flat config style in `index.ts`.

3. **LLM willingness prompt context: topic summary**
   - What we know: Decision says "触发消息 + 话题摘要（非完整历史）"
   - What's unclear: How to get topic summary without full history — HorizonService.buildView() fetches full history
   - Recommendation: Use last 3 messages from Timeline as "recent context" via `EventManager.query()` with `limit: 3`. This avoids full buildView() overhead and provides sufficient topic signal.

---

## Sources

### Primary (HIGH confidence)

- `plugins/core/src/services/agent/service.ts` — AgentCore.handlePercept(), enqueue(), runLoop() — insertion points verified
- `plugins/core/src/services/agent/loop.ts` — ThinkActLoop.run() — delay insertion point, generateText pattern
- `plugins/core/src/services/agent/config.ts` — AgentCoreConfig — fields to extend
- `plugins/core/src/services/horizon/types.ts` — UserMessagePercept.triggerType, TriggerType enum
- `plugins/core/src/services/horizon/listener.ts` — classifyTrigger() — confirms triggerType values
- `plugins/core/src/services/model/service.ts` — ModelService.getModel() — willingness LLM call pattern
- `plugins/core/src/services/plugin/builtin/send-message.ts` — ctx.bots.find() pattern, <sep/> splitting
- `plugins/core/src/index.ts` — sleep import, config schema pattern
- `D:\Codespace\koishi-dev\YesWeAreBot\YesImBot-v3\packages\core\lib\agent\willing.d.ts` — v3 WillingnessManager reference
- `D:\Codespace\koishi-dev\YesWeAreBot\YesImBot-v3\packages\core\lib\agent\config.d.ts` — v3 WillingnessConfig reference

### Secondary (MEDIUM confidence)

- ai-sdk v6 `generateText` with `maxTokens: 5` for binary LLM judgment — verified against installed type definitions

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages, all patterns verified in existing codebase
- Architecture: HIGH — insertion points identified in actual source files
- Pitfalls: HIGH — derived from reading actual code paths
- LLM willingness prompt design: MEDIUM — Claude's discretion, no external verification needed

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable patterns, 30 days)
