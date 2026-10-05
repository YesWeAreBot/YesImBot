# YesImBot OneBot directory

Optional YesImBot v3 legacy plugin. Requires Koishi's database service, the OneBot adapter and YesImBot's tool service. It stores contacts in Koishi's configured database; it does not create a file directory cache. The Koishi plugin setting `enabled` defaults to `true`. Turning it off stops tool and command registration and database activity while preserving previously stored data for later use.

## Model tool

`onebot_contacts` is available in OneBot conversations. It accepts `kind=friends|members`, `mode=count|lookup|page`, and an optional `group_id` (defaults to the current group). `lookup` requires an exact `user_id`; `page` accepts `offset` and `limit` (default 10, maximum 20). The model tool cannot request a full list or force a refresh. Each conversation can receive up to 80 entries and 40 calls per ten minutes; returned text fields are capped at 80 characters each. `count` returns the size without entries. In a public group, the model can query only that group’s members. Friend lists and other groups require an administrator’s private conversation; missing authority is denied. On a cache miss the plugin fetches a complete list from OneBot into the database, then returns only the requested count, user or page. The tool response includes the snapshot time and the bot account that fetched it.

## Admin commands

- `onebot.contacts.friends [-o OFFSET] [-n LIMIT] [--all] [-r]`
- `onebot.contacts.members [-g GROUP_ID] [-o OFFSET] [-n LIMIT] [--all] [-r]`

Koishi authority 3 is required. `-g` is required outside a group. `-r` explicitly replaces the cached snapshot; otherwise a complete existing snapshot is returned without an automatic expiry. A damaged snapshot is automatically fetched again; failed repair reports an error instead of returning an incomplete list. `--all` is available only on the admin command and sends results in batches of 40 lines. All command output is plain text, including IDs, names, roles, headers and errors; strings such as `<at type="all"/>` are displayed literally. A plugin may call `DirectoryStore.query` with `refresh: true` to request an update.

## Sharing and load

Friend lists belong to individual bot accounts. Group lists are shared by bot accounts on the same platform and group ID within the same Koishi database. The snapshot records which bot fetched it. Identical group IDs on different platforms are kept separate: a future adapter can only share them after providing an explicit, verified mapping to the same real group. Different bot roles may see different member details; an admin can refresh from the bot whose view is needed.

A refresh fetches the full array through OneBot, writes it in batches (default 100), and publishes a new snapshot only after all writes succeed. Concurrent requests in one plugin instance for the same group share a fetch; at most two distinct scopes fetch at once by default. Preparing revisions younger than one hour remain available while later updates run. A failed batch write leaves the published snapshot in place. Database reads are paginated. OneBot's list API itself is not paginated, so a cache miss or explicit refresh still waits for one complete adapter response.

Each contact has an immutable `revisionCreatedAt`. On queries and refreshes, the plugin deletes noncurrent revisions older than one hour, including abandoned preparations. The delete checks the current snapshot in a database subquery instead of using a previously read pointer. The current complete cache is retained even after that hour; inactive scopes do not grow, and their expired versions are reclaimed on their next access. Versions accumulated within the hour are bounded by refresh rate and directory size, rather than by a fixed generation count.

Every read checks the revision and its full contact count after reading all requested pages (also for count and exact lookup). If the pointer changed, it discards the result and reads the newest revision. If a published revision is incomplete, it fetches a replacement from the querying bot. At most three read attempts are made; continuous updates or a failed repair produce an error. This also repairs dangling pointers left by older plugin versions.

Multiple plugin instances sharing one Koishi database can prepare revisions independently. Preparation taking longer than one hour can be reclaimed: refresh validates its member count before and after publishing and reports an error if it lost rows. A cleanup between those checks can temporarily leave an incomplete published pointer, which subsequent reads detect and repair automatically. Once publication starts, its contacts remain eligible only for pointer-aware TTL cleanup, so a database response error cannot erase a complete cache that may already have committed. A crash in that window likewise produces a repairable cache rather than a successful empty response. Normal complete caches never trigger an automatic OneBot fetch.

These guarantees assume the configured database driver provides coherent shared reads and writes. Cross-process deployments need a database/driver that supports concurrent use; the plugin does not add file locking to a driver.

Tables: `yesimbot.onebot_directory_snapshots` and `yesimbot.onebot_directory_contacts`.

The shared group directory is a read cache, not a conversation scene or message history. It does not assign scene ownership or merge agent logs between bots.
