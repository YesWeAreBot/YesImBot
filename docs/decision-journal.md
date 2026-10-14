# 决策记录目录与单写入者

启用 `decisionRecording.enabled` 后，日志保存在 `decisionRecording.directory` 下的 `decisions.jsonl`。默认目录为 Koishi 工作目录下的 `data/yesimbot/decisions`；既有查询和离线回放继续使用这个文件。

同一个目录只允许一个实例写入，包括同一进程中的多个插件实例和不同进程。记录器初始化时先以原子独占方式建立 `.decisions.lock`，然后才读取或整理历史。第二个实例会输出明确警告，并停用该实例的本地记录与查询；其 `list()` 返回空数组，追加的记录计入 `droppedRecords`。实时决策不受影响。第二个实例不会自动接管：为每个实例配置独立目录，或关闭当前写入者后重新启动需要记录的实例。回放分别指定各自目录中的 `decisions.jsonl`。

正常关闭会先完成已排队的写入和刷新，再释放锁。初始化失败也会释放已取得的锁。异常退出或锁释放失败可能留下 `.decisions.lock`；记录器不会凭 PID 或时间自动删除残留锁，以免误判仍在运行的写入者。

遇到锁警告而确认是异常退出残留时：

1. 停止所有使用这个目录的 Koishi／YesImBot 实例，确认没有相关进程仍在运行。锁文件中的 `pid` 仅用于排查，不能单独证明锁已失效。
2. 在配置的 `decisionRecording.directory` 目录中，只删除 `.decisions.lock`，保留 `decisions.jsonl`。不要在写入者运行时删除锁。
3. 重新启动一个实例。它会从原 `decisions.jsonl` 恢复历史，随后继续记录；其他实例应使用独立目录。

目录与文件系统必须支持独占创建文件的语义。不要让新旧版本同时写入同一目录，因为旧版本不检查这个锁。
