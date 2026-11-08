# Vision, tool delivery, and configuration reliability

**Goal:** Preserve direct image input across a conversation, make execution deadlines match tool behavior, and organize configuration by user task.

**Architecture:** Keep existing configuration storage paths and native Koishi field types. Image selection remains before context budgeting. Tool execution preserves confirmed delivery independently of its final promise, and recoverable reads return observations without automatically repeating side effects.

## Constraints

- Global direct-vision settings and the selected chat group's declared abilities determine direct image input.
- Internal heartbeats do not consume separate user-task image allowances.
- Related-image restoration respects conversation scope, history generation, input budget, and image limits.
- Auxiliary image description serves text-only or explicitly enabled weak-vision use.
- Cancellation, revocation, and shutdown still suppress late side effects.
- A timeout cannot erase confirmed receipts or authorize replay of uncertain delivery.
- Existing configuration values and unknown extension fields survive edits and folding.
- Configuration checks must include native Koishi controls; an unrelated HTML mock does not validate the console.

## Tasks

1. Image continuation: reproduce image input followed by an unquoted question and intervening tool heartbeats; retain bounded related sources and expose exclusion diagnostics.
2. Tool deadlines: reproduce a slow image request and a segmented message with typing delays; provide explicit effective deadlines and preserve confirmed/uncertain delivery state.
3. Recovery: feed read failures back to the model within heartbeat limits, stop dependent batch actions, and avoid automatic replay of writes.
4. Format correction: preserve the original persona, question, tool history, and images during bounded correction; honor zero retries and immediate failover.
5. Configuration: project existing fields into seven purpose groups with compact native controls and actual nested folding; keep dynamic enable branches and a unique editor per path.
6. Verification: run focused regressions, complete suite, build, lint, formatting, independent installed-package smoke tests, and actual console interaction where the environment permits it.

## Review focus

- Image input after a model switch or context compaction.
- Revocation or history clearing during image restoration and tool execution.
- Confirmed first segment with a blocked second segment, including segments inside one platform encoder.
- An uncertain platform response must never be described as definitely unsent.
- Disabled extensions, dynamic schema updates, and unknown configuration fields during save.
- Repeated invalid outputs must neither lose the original context nor create unbounded correction history.

## Delivery

Publish verified changes to the existing fork integration branch after independent review. Preserve its current remote head and verify the published source tree against the tested tree.
