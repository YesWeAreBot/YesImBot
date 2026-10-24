# Background tool tasks

## Behavior

The feature is disabled by default. When enabled, the model may submit an explicitly background-capable tool through `background_task_start`, inspect it through `background_task_query`, or cancel it through `background_task_cancel`. Direct tool calls retain serial execution, and tools with sequencing or mutation requirements remain ineligible unless their implementation explicitly opts in. Administrators can inspect and cancel tasks with authority-3 commands.

Tasks belong to one plugin instance, bot account and conversation, including Telegram guild/topic and private-user identity. A fresh guarded session and independent cancellation scope detach jobs from foreground turns. History clear, revoked authorization and service shutdown invalidate results. Cancellation reports an in-flight request as cancelling until it actually settles; late success cannot revive cancellation. Raw external effects cannot be undone by the registry.

A bounded current snapshot is added to each model context, with progress reported only by actual tool execution. Full results are queried explicitly and reuse paged tool-output storage. Registry state is in memory and does not restart tasks after reload.

Completion handling is configurable: wait for the next normal cycle, or submit a completion stimulus for a normal willingness decision. Success, failure and cancellation bonuses are independently configurable, including zero. Settlement is configurable per task or per model request. Request settlement waits until submission is closed and all its jobs finish; mixed outcomes classify as failure, then cancellation, otherwise success. Background decisions never reapply the source message's mention/private/keyword gains. Completion events queued during active foreground execution are retained independently of the new-message policy.

## Architecture and alternatives

Use asynchronous jobs with bounded concurrency, not OS threads. Keep all existing tool entry points and add explicit job tools. Automatically detaching every eligible tool was rejected because a capability declaration cannot express each call's data dependencies. A full persistent multi-agent runtime is outside scope.

## Defaults and constraints

Defaults: disabled; completion waits; all bonuses zero; per-request settlement; concurrency 4; retained task limit 128; timeout 120 seconds. All behavior choices remain configurable. No new dependencies, changes to message XML conventions, automatic retries of completed work, or conversation-derived comments.
