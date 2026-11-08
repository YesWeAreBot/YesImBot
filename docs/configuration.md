# 核心插件配置

打开 YesImBot 核心插件的配置页，先按用途选择大类，再展开需要调整的功能。收起功能组不会清除尚未保存的修改。开关、数字输入、模型选择、表格和模板编辑框均可直接操作；修改完成后使用控制台的保存操作。

| 大类         | 可以调整什么                                                                                   | 配置文件字段                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型与连接   | 提供商地址与密钥、模型能力、模型组、聊天及嵌入任务分配                                         | `providers`、`modelGroups`、`task`                                                                                                                                                                                                                                                            |
| 对话与回复   | 响应频道、唤醒条件、新消息策略、回复暂停、发言意愿、参与保持、等待后续消息、接话判断、发送节奏 | `allowedChannels`、`prioritizeMentions`、`debounceMs`、`newMessageStrategy`、`deferredProcessingTime`、`replySuppression`、`base`、`attribute`、`interest`、`lifecycle`、`participation`、`continuation`、`typesafe`、`topics`、`extra.core_util.typing`、`extra.core_util.deliveryTimeoutMs` |
| 记忆与上下文 | 是否记录机器人自己的消息、输入预算、近期完整轮次、核心记忆文件、语义检索和长期日记             | `ignoreSelfMessage`、`contextInputBudgetTokens`、`l1_memory`、`coreMemoryPath`、`l2_memory`、`l3_memory`                                                                                                                                                                                      |
| 视觉与图片   | 视觉开关、附图数量与保留规则、辅助识图模型与超时、图片处理、图片占位符说明                     | `enableVision`、`allowedImageTypes`、`maxImagesInContext`、`imageLifecycleCount`、`imageFollowUpWindowSeconds`、`imageFollowUpMaxTurns`、`detail`、`extra.core_util.vision`、`image`、`multiModalSystemTemplate`                                                                              |
| 角色与提示词 | 系统和用户模板、扩展注入占位符、模板渲染选项                                                   | `systemTemplate`、`userTemplate`、`injectionPlaceholder`、`maxRenderDepth`                                                                                                                                                                                                                    |
| 工具与任务   | 原生工具调用、动作纠正、单轮执行次数、后台任务、超时与重试、扩展工具开关                       | `nativeToolCalling`、`nativeToolCorrectionRetries`、`streamAction`、`heartbeat`、`backgroundTools`、`advanced`、`extra` 中其余扩展设置                                                                                                                                                        |
| 存储与维护   | 文件存储与下载、资源清理、历史保留、日志、错误上报、决策记录                                   | `storagePath`、`driver`、`assetEndpoint`、`maxFileSize`、`downloadTimeout`、`recoveryEnabled`、`autoClear`、`logLengthLimit`、`dataRetentionDays`、`cleanupIntervalSec`、`logging`、`errorReporting`、`decisionRecording`                                                                     |

## 图片设置

先在“模型与连接”的提供商中登记模型，并勾选该模型支持的视觉能力。模型能力描述该模型可以做什么；“视觉与图片”决定聊天时是否附图、如何处理图片。

“视觉开关与附图规则”控制直接发送给聊天模型的图片。“辅助识图模型与超时”设置图片描述工具使用的模型、细节程度及等待时间；聊天模型已经收到图片时，是否仍允许辅助识图由该处的独立开关控制。

辅助识图和发送节奏属于核心工具集。关闭“工具与任务 → 扩展工具开关与设置”中的核心工具集后，这两项设置暂不显示；重新启用后可继续调整原先填写的值。其他扩展的设置仍在各自的扩展工具项中。

## 模型与工具超时

模型请求的等待时间在“模型与连接 → 模型提供商 → 模型列表 → 超时策略”中设置。普通工具的默认超时和单工具覆盖在“工具与任务 → 工具超时与重试”中设置。后台任务另有自己的超时。

| 设置位置                        | 作用                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| 视觉与图片 → 辅助识图模型与超时 | 辅助识图总超时；填 `0` 时按所选模型的超时、重试和准备时间计算               |
| 对话与回复 → 发送节奏与超时     | 发送总超时；填 `0` 时按分段数量、打字延迟和传输预算计算                     |
| 工具与任务 → 工具超时与重试     | 普通工具默认等待 10000 毫秒；可按工具名指定覆盖值，覆盖值优先于工具自身预算 |
| 工具与任务 → 后台任务           | 后台执行同时受工具预算和后台任务总上限约束，取较短者                        |

只读工具失败后，模型可在本轮次数上限内调整查询或继续回复。消息发送等有副作用的操作不会自动重放；已经确认发送的消息会保留回执，结果不确定时也不会直接当作未发送。用户取消或新消息中断后，旧轮次不会继续执行。

## 手机上操作

先收起不用的大类，再展开当前功能。长表格可以在表格区域内横向滚动；数字、下拉选择和长文本输入会按屏幕宽度排列。
