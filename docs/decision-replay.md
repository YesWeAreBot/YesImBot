# 本地决策记录与离线回放

在 YesImBot 配置中打开 `decisionRecording.enabled`，即可保存本地 JSONL 决策记录。该功能默认关闭，不调用额外模型。

```yaml
decisionRecording:
    enabled: true
    directory: data/yesimbot/decisions
    maxEntries: 10000
    maxBytes: 10485760
    retentionHours: 72
```

`directory` 相对 Koishi 的工作目录解析，也可使用绝对路径。记录文件是该目录中的 `decisions.jsonl`；目录权限为 `0700`，文件权限为 `0600`。关闭插件时会等待已排队的记录写完并刷新文件。

每行是一个版本为 `1` 的决策快照，包含决策 ID、会话标识、时间、刺激类型、阶段、固定原因码和已算出的数值。允许存储目标标识、回复类别、语义判断的模式/状态/数值结果以及参与保持状态；不保存消息正文、提示词、请求头、凭据或任意异常文本。未知的阶段/刺激类型记为 `unknown` 并提示；未知原因码不保存。

记录按条数、UTF-8 字节数和保留时长限制，超过容量会移除较早写入的快照。过期记录在启动、追加、查询或刷新时清理。重启后恢复仍保留的记录；文件过大时流式读取，单行最多接受 `1 MiB`。版本不兼容、损坏、缺少必要字段或不完整的末行会明确警告并跳过。待写队列也受容量限制；队列满或写盘失败会发出警告，不阻断实时回复。

管理员可在群聊或私聊中执行 `chat.decisions` 查看当前会话最近 10 条快照，或执行 `chat.decisions 30 --from 2026-09-30T00:00:00Z --to 2026-09-30T23:59:59Z` 按时间筛选。一次最多查询 100 条；发生裁剪或丢弃时，会显示历史不完整的提示。该指令只查看记录，不执行历史动作。

## 运行回放

先关闭插件或复制一份稳定的记录文件，再在 Koishi 工作目录运行：

```bash
node node_modules/koishi-plugin-yesimbot/scripts/replay-decisions.cjs \
  data/yesimbot/decisions/decisions.jsonl
```

在源码仓库中，可改用 `node packages/core/scripts/replay-decisions.cjs <file>`。脚本只依赖 Node.js 内置模块，无需构建 `lib`；它不加载 Koishi，不调用模型、工具或发送功能，不修改在线意愿状态或输入文件。

使用 `--key` 精确匹配 JSONL 中的 `key`，使用带时区的 ISO 时间筛选闭区间：

```bash
node node_modules/koishi-plugin-yesimbot/scripts/replay-decisions.cjs decisions.jsonl \
  --key '["onebot","12345","67890"]' \
  --from 2026-09-30T00:00:00Z --to 2026-09-30T23:59:59Z
```

输出同样为 JSONL。可复算的行包含 `recomputed` 和 `matches`：

```json
{
    "id": "example",
    "stage": "calculated",
    "status": "replayed",
    "recomputed": {
        "rawGain": 8,
        "effectiveGain": 12,
        "after": 22,
        "threshold": 20,
        "amplifier": 0.1,
        "probability": 0.2,
        "roll": 0.15,
        "decision": true
    },
    "matches": true
}
```

复算公式为：

```text
rawGain = (baseScore × interestMultiplier × participationMultiplier) × marginalMultiplier
effectiveGain = rawGain × dynamicMultiplier × assessmentMultiplier
after = min(before + effectiveGain, maxWillingness)
probability = after > threshold ? clamp((after - threshold) × amplifier, 0, 1) : 0
decision = roll < probability
```

`matches` 同时核对原记录的增益、最终意愿、概率和判定；浮点数允许相对误差 `1e-9`。同一决策 ID 的多个阶段可能携带相同计算，脚本优先复算 `calculated` 阶段，缺少该阶段时采用第一个完整计算，只复算一次，其余显示 `duplicate_calculation`。调度、系统事件或取消记录没有计算时显示 `no_calculation`；缺少计算字段显示 `missing_calculation_data`，不会补造输入。

最后一行的 `summary` 汇总筛选后的事件、已复算决策、重复计算、不一致、缺少计算、版本不兼容、损坏、超大和未知元数据的数量。它采用 `independent_records_not_full_trajectory` 模式：每条计算使用记录中的 `before` 和乘数，历史可能因容量、过期或写入失败而缺失，结果不能视为完整的在线状态轨迹。去重索引最多包含 `100000` 个决策 ID；超出时明确退出，请缩小会话/时间范围或拆分文件。

## 比较阈值或放大系数

```bash
node node_modules/koishi-plugin-yesimbot/scripts/replay-decisions.cjs decisions.jsonl \
  --threshold 30 --amplifier 0.2
```

每条可复算记录增加 `scenario`，并保留原来的 `roll`。未指定的参数沿用原值。`recomputed` 和 `matches` 仍核对原始参数，`scenario` 单独展示假设参数下的概率和判定。调整参数不会重新抽样，也不会把新判定、回复成本或衰减传递给下一条记录；这是独立记录的情景比对，不是完整对话轨迹重演。

参数无效、文件不可读或输出失败时脚本以非零退出码结束；输入记录的不兼容、损坏和缺少数据则在汇总中计数，请检查这些数量后再解释结果。
