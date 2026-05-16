# Agent Session Spec

## Compaction & Context Window

### Design Decision: Pre-prompt context window enforcement

**Context**: `AgentSession` restores persisted messages from `SessionManager` on construction. If the session had no prior compaction, the restored context may exceed `contextWindow`. The existing `_checkCompaction` method relies on assistant message `usage` data, which may be empty/stale for restored messages.

**Decision**: Add a separate `_ensureContextWindowLimit()` method that uses `estimateContextTokens()` (chars/4 heuristic, works without usage data) to check context size before sending to LLM.

**Key pattern**:
```typescript
private async _ensureContextWindowLimit(): Promise<void> {
  if (this._contextWindowCheckDone) return; // prevent re-entry
  this._contextWindowCheckDone = true;
  if (!this._compactionSettings.enabled) return;
  const estimate = estimateContextTokens(this.agent.state.messages);
  if (shouldCompact(estimate.tokens, this._contextWindow, this._compactionSettings)) {
    if (!this.model) return; // graceful degradation
    await this._runAutoCompaction("threshold", false);
  }
}
```

**Why `estimateContextTokens` over `calculateContextTokens`**: `calculateContextTokens` reads `assistant.usage.totalTokens` — only available after a successful LLM response. Restored sessions may have no usage data. `estimateContextTokens` falls back to chars/4 heuristic and always returns a value.

**Anti-infinite-loop**: `_contextWindowCheckDone` flag runs the check at most once per prompt cycle. Reset on `agent_end` and `message_start(user)`.

### Gotcha: `_checkCompaction` skips for restored sessions

`_checkCompaction` has multiple guard conditions that silently skip the check:
- No assistant message → skipped
- Assistant message from before latest compaction boundary → skipped
- Assistant usage data empty → `calculateContextTokens` returns 0 → `shouldCompact` returns false

This is by design (prevents false triggers from stale data), but means restored sessions need the separate `_ensureContextWindowLimit` path.

### Compaction trigger points (summary)

| Trigger | Method | When | Data source |
|---------|--------|------|-------------|
| Pre-prompt (new) | `_ensureContextWindowLimit()` | Before LLM call | `estimateContextTokens` (chars/4) |
| Pre-prompt (existing) | `_checkCompaction()` | Before LLM call | `calculateContextTokens` (usage) |
| Post-response | `_checkCompaction()` via `agent_end` | After LLM response | `calculateContextTokens` (usage) |
| Manual | `compact()` | User-initiated | `prepareCompaction` |

## Settings Management

### Design Decision: Dual-scope SettingsManager

**Context**: `AgentSession` previously received all config via constructor (`AgentSessionConfig`), with no runtime persistence. Settings like `compaction.reserveTokens`, `retry.maxRetries`, `contextWindow` were hardcoded or constructor-only. Changes were lost on restart.

**Decision**: Replace `AgentSessionConfig` settings fields with a `SettingsManager` instance that provides dual-scope (global + local) settings with auto-persistence.

**Architecture**:
```
SettingsManager
├── global: Settings  ← {basePath}/settings.json
├── local:  Settings  ← {channelDir}/settings.json
├── merged: Settings  ← local > global > defaults
├── dirty tracking (per-scope)
└── write queue (serialized)
```

**Key rules**:
- `AgentSessionConfig` no longer has `contextWindow`, `compactionSettings`, `retrySettings`, `initialSteeringMode`, `initialFollowUpMode` — all read from `settingsManager`
- All settings fields are optional; missing → `DEFAULT_SETTINGS` values
- Merge: local overrides global, recursive for nested objects (`compaction`, `retry`)
- Setters (`setAutoCompactionEnabled`, `setSteeringMode`, etc.) persist via `settingsManager.set*()` calls
- `contextWindow` default raised from 65536 to 128000

**File layout**:
```
{basePath}/settings.json                    # global
{sessions}/{encoded_channel}/settings.json  # local (per-channel)
```

**Storage**: atomic write via temp+rename (`FileSettingsStorage`), no file locking needed (single-process). `InMemorySettingsStorage` for tests.

**Gotcha**: `settingsManager` is required in `AgentSessionConfig` — no fallback to old config style. RuntimeService creates it before AgentSession.
