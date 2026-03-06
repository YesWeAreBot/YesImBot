# Message Hook Coverage

## Overview

This document defines which message send paths in Athena have hook coverage and which are intentionally excluded.

**Architecture Decision:** Message hooks are designed for **user-facing messages** sent through the agent's tool system. Internal system messages bypass hooks to prevent interference with error reporting and system operations.

## Message Send Paths

### 1. User-Facing Messages (Hooked)

**Path:** `send_message` action in `CorePlugin`

**Location:** `core/src/services/plugin/builtin/core.ts:86-96`

**Hook Coverage:** ✅ Full coverage via `HookType.Message`

**Flow:**

```typescript
// Before hook execution
const beforeResult = await hookService.executeBefore(
  HookType.Message,
  { content, session: ctx.session },
  ctx.percept?.traceId,
);
if (beforeResult.skipped) {
  return beforeResult.result as ToolResult;
}
content = (beforeResult.params as { content: string }).content;
```

**Use Cases:**

- Agent responses to user messages
- Tool-triggered messages
- All messages sent through the agent's think-act loop

**Plugin Capabilities:**

- Modify message content before sending
- Skip message sending entirely
- Add metadata or logging
- Implement content filters or transformations

### 2. Cross-Channel Messages (Hooked)

**Path:** Direct `bot.sendMessage()` call with target parameter

**Location:** `core/src/services/plugin/builtin/core.ts:127`

**Hook Coverage:** ✅ Covered (goes through same `send_message` action)

**Flow:**

```typescript
// Hook executes before this line
await bot.sendMessage(channelId, parsed);
```

**Note:** Cross-channel sends use the `target` parameter in `send_message` action, so they pass through the same hook point.

### 3. Current Channel Messages (Hooked)

**Path:** Session send via `ctx.session?.send()`

**Location:** `core/src/services/plugin/builtin/core.ts:139`

**Hook Coverage:** ✅ Covered (goes through same `send_message` action)

**Flow:**

```typescript
// Hook executes before this line
await ctx.session?.send(elements);
```

**Note:** Standard message sends to the current channel pass through the same hook point.

## Uncovered Paths (By Design)

### 4. Error Reporting Messages (Intentionally Uncovered)

**Path:** Direct `bot.sendMessage()` in error handler

**Location:** `core/src/services/agent/service.ts:533`

**Hook Coverage:** ❌ Intentionally bypassed

**Rationale:**

- Error messages are system-level notifications
- Must be reliable and not subject to plugin interference
- Plugins should not be able to suppress error reports
- Prevents infinite loops if hooks themselves cause errors

**Flow:**

```typescript
// No hook execution - direct send
await bot.sendMessage(channelId, summary).catch(() => {});
```

**Use Cases:**

- Agent loop errors
- System failures
- Critical error notifications

## Design Principles

1. **User-Facing = Hooked:** All messages sent through the agent's tool system have hook coverage
2. **System-Level = Unhooked:** Internal error reporting and system messages bypass hooks
3. **Single Hook Point:** All user-facing messages funnel through one hook point in `send_message` action
4. **Fail-Safe:** Error reporting must work even if hooks are broken

## Testing Strategy

### Coverage Verification

Test that hooked paths execute hooks:

- `send_message` action triggers `HookType.Message` before hook
- Hook can modify content
- Hook can skip sending

### Exception Verification

Test that uncovered paths bypass hooks:

- Error reporting sends directly without hook execution
- System messages are not intercepted

## Future Considerations

If additional message send paths are added:

1. **Ask:** Is this a user-facing message or system message?
2. **User-facing:** Route through `send_message` action (automatic hook coverage)
3. **System message:** Use direct `bot.sendMessage()` and document in this file

## Related Documentation

- Hook system architecture: `docs/ARCHITECTURE.md`
- Hook integration: `.planning/phases/44-extensibility-infrastructure/44-03-SUMMARY.md`
- Hook API: `core/src/services/hook/service.ts`
