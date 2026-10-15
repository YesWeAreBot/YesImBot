# YesImBot 持久提醒

独立、默认关闭的 Koishi 插件。启用 `enabled: true` 后，提醒保存到 Koishi 数据库，到期提交一次定向 Agent 唤醒；它不直接发送消息，也不保存或执行任意工具调用。

需要数据库服务，以及支持以下接口的 YesImBot core：公开 `shared.getInstanceScope(ctx, warn, { owner })`、可信工具会话和按注册实例注销工具、`world.stimulusOwnerId` 定向刺激、历史 generation 保护、带 botKey 的频道事件隔离，以及系统事件持久写失败向调用者抛出。仅包版本号无法判断这些能力；启用时会检查关键接口。生产环境请使用持久数据库，内存数据库不会跨进程保留提醒。

## 配置与调用

- `enabled`：默认 `false`。
- `pollIntervalSeconds`：到期检查间隔，1–60 秒，默认 5 秒；到期时间不是精确发送保证。
- `schedule_reminder`：`deadline` 为未来 366 天内的 Unix 毫秒整数，`content` 为 1–2000 字符正文，`idempotency_key` 为 1–128 字符请求键。截止时间必须明确转换到 UTC 时间戳。
- `cancel_reminder`：传入提醒 `id`，只能取消当前用户在当前机器人、当前频道创建的待处理提醒。

工具目标从 core 注入的可信 Session 获取，模型无法指定其他 platform、selfId、channelId 或 requester。正文作为普通系统事件的 `message` 保存；它不会成为 system prompt、工具配置或代码。刺激只包含任务 ID，正文由正常上下文链路读取。

管理员（Koishi authority ≥ 3）可在当前机器人、当前频道执行：

```text
reminder.list
reminder.cancel <id>
reminder.retry <id>
```

`list` 返回最近 100 条状态、截止时间和错误码；管理员可管理当前频道其他用户的提醒。目标同时匹配会话类型与 guildId；未知 guildId 只匹配未知目标，不扩大到其他群。命令不提供跨机器人或跨频道目标参数。`retry` 只接受 `failed`，立即重新排队，必须显式调用。

## 持久化与隔离

表 `yesimbot.durable_tasks` 保存 `queued / running / completed / failed / cancelled`。owner 组合 core 与独立插件的持久实例 scope；幂等 ID 再组合 platform、selfId、channelId、会话类型、明确已知的 guildId（未知为空串）、requester 与请求键，数据库主键处理并发重复提交，数据库条件更新决定唯一 claim。

插件需要 Koishi Loader 提供稳定配置项标识。找不到稳定 scope 时 core 会告警并提供独立临时标识；此时重启不会接管旧任务，不能把这种部署视为可靠恢复。

启动时保留 `queued`，将该 owner 遗留的 `running` 转为 `failed`，错误码 `interrupted_requires_retry`。不自动重放不确定副作用。投递失败同样不自动重试。显式重试可能重复已有的唤醒或普通事件。

到期时重新核验 bot 在线、适配器可读取目标频道及频道类型、插件过滤器、core 允许频道、bot 禁言与 `scheduled`/`all` 暂停规则。无法核验就失败关闭。私聊适配器若不能通过 `getChannel` 验证私聊频道，也不会投递；没有绕过验证的回退发送。

投递先使用历史 generation 保护记录普通频道事件（`eventScope: channel`，`botKey: [platform,selfId]`），然后再次检查运行状态、权限、实例 owner 和 generation，通过 `ctx.emit(session, 'agent/stimulus', stimulus, world.stimulusOwnerId)` 定向唤醒。清历史或卸载期间的迟到工作不会重新唤醒。取消会阻止尚未提交的投递，但无法撤回已提交事件、唤醒或 Agent 开始的回复。

`completed` **只表示已提交 Agent 唤醒**，不代表模型接受、消息发送或用户收到。数据库与事件总线之间不存在分布式事务；这里提供数据库 claim 去重与不确定状态的显式重试，不承诺跨崩溃的 exactly-once。终态记录保留用于幂等和审计，尚无自动清理策略。

## 验证

```sh
yarn vitest run packages/durable-tasks/tests
yarn tsc -p packages/durable-tasks
yarn oxlint packages/durable-tasks
yarn oxfmt --check packages/durable-tasks
```

测试使用真实 Koishi 内存数据库和 mock bot，覆盖 CAS、重启恢复、跨 owner/目标隔离、取消/卸载竞争、generation 和 owner 变化、真实命令权限及到期 event/stimulus 链路。线上数据库与真实适配器仍需部署环境验证。
