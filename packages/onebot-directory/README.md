# YesImBot OneBot directory

Optional YesImBot v3 legacy plugin. Requires Koishi's database service, the OneBot adapter and YesImBot's tool service. It stores contacts in Koishi's configured database; it does not create a file directory cache. The Koishi plugin setting `enabled` defaults to `true`. Turning it off stops tool and command registration and database activity while preserving previously stored data for later use.

## Model tool

`onebot_contacts` is available in OneBot conversations. It accepts `kind=friends|members`, `mode=count|lookup|page`, and an optional `group_id` (defaults to the current group). `lookup` requires an exact `user_id`; `page` accepts `offset` and `limit` (default 10, maximum 20). The model tool cannot request a full list or force a refresh. Each conversation can receive up to 80 entries and 40 calls per ten minutes; returned text fields are capped at 80 characters each. `count` returns the size without entries. In a public group, the model can query only that group’s members. Friend lists and other groups require an administrator’s private conversation; missing authority is denied. On a cache miss the plugin fetches a complete list from OneBot into the database, then returns only the requested count, user or page. The tool response includes the snapshot time and the bot account that fetched it.

## Admin commands

- `onebot.contacts.friends [-o OFFSET] [-n LIMIT] [--all] [-r]`
- `onebot.contacts.members [-g GROUP_ID] [-o OFFSET] [-n LIMIT] [--all] [-r]`

Koishi authority 3 is required. `-g` is required outside a group. `-r` explicitly replaces the cached snapshot; otherwise an existing snapshot is returned without an automatic expiry. `--all` is available only on the admin command and sends results in batches of 40 lines. A plugin may call `DirectoryStore.query` with `refresh: true` to request an update.

## Sharing and load

Friend lists belong to individual bot accounts. Group lists are shared by bot accounts on the same platform and group ID within the same Koishi database. The snapshot records which bot fetched it. Identical group IDs on different platforms are kept separate: a future adapter can only share them after providing an explicit, verified mapping to the same real group. Different bot roles may see different member details; an admin can refresh from the bot whose view is needed.

A refresh fetches the full array through OneBot, writes it in batches (default 100), and publishes a new snapshot only after all writes succeed. Concurrent requests for the same group share a fetch; at most two distinct scopes fetch at once by default. The previous snapshot remains readable while a later update is prepared. A failed update leaves the published snapshot in place. Database reads are paginated. OneBot's list API itself is not paginated, so a cache miss or explicit refresh still waits for one complete adapter response.

Tables: `yesimbot.onebot_directory_snapshots` and `yesimbot.onebot_directory_contacts`.

The shared group directory is a read cache, not a conversation scene or message history. It does not assign scene ownership or merge agent logs between bots.
