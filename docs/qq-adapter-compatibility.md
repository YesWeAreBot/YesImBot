# QQ 适配器兼容

YIB 使用 Koishi 的消息编码接口发送内容。官 Bot、OneBot 与社区适配器的频道 ID 和内部 API 不可混用。

## 兼容接口

| 适配器                     | 私聊频道                                      | 发送会话                                                         |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 官 Bot QQ 4.7.5            | `createDirectChannel()` 返回用户 ID           | 私聊需要 DIRECT 频道类型；旧图片上传接口还读取目标用户或群组信息 |
| 官 Bot QQ 4.14.0           | `createDirectChannel()` 返回用户 ID           | 保留原会话的被动消息 ID 与共享序号                               |
| `qq-crack`                 | `createDirectChannel()` 返回 `private:用户ID` | 使用适配器返回的频道 ID，保留引用等消息元素                      |
| OneBot 的旧 `qqguild` 接口 | 由适配器解析                                  | 使用 `sendGuildChannelMsg` 等 OneBot 出站接口                    |

同名的 `qqguild` 平台可能使用独立官 Bot 编码器或旧 OneBot 接口。发送保护根据可用接口选择路径，不将所有 `qqguild` 实例视为 OneBot。

上述接口对应固定源码版本；验证使用真实 Koishi 编码生命周期与本地 API 接收端，不能代替账号权限、平台审核及远端发送的部署验证。

## 发送目标

`send_message` 保留 `target: "平台:原生频道ID"` 格式。省略目标时回复当前会话。

- `self_id`：可选的机器人账号 ID。同平台默认使用当前账号；其他平台有多个账号时必须明确指定。
- `target_type: "channel"`：默认值，目标为原生频道 ID。
- `target_type: "private"`：目标为用户 ID，通过适配器的 `createDirectChannel()` 解析实际私聊频道。

向指定用户私聊：

```json
{ "message": "你好", "target": "qq:用户ID", "target_type": "private", "self_id": "机器人账号ID" }
```

原会话回复保留原始发送上下文，以便适配器管理被动回复序号。其他目标使用新的路由会话，不携带触发消息 ID、触发事件或原发送序号。QQ 的兼容私聊写法 `qq:private:用户ID` 也通过适配器解析；已处于该私聊时保持原会话。

消息 XML 交给所选适配器编码。旧版未实现的引用、媒体或原生组件不会由 YIB 自动转换成另一套平台接口。适配器未返回消息 ID 时明确返回无法确认的错误，不自动重发，避免重复投递。

## 源码参照

- [Koishi QQ 插件入口](https://github.com/koishijs/upstream/tree/main/adapter/qq)：转导出 `@satorijs/adapter-qq`。
- [官 Bot QQ 4.7.5](https://github.com/satorijs/satori/tree/4c68dc235aabd5af9b938ce4276b87a35aa0826a/adapters/qq)：历史稳定接口。
- [官 Bot QQ 4.14.0](https://github.com/satorijs/satori/tree/7606a0c3bd1ec7756a893bfce4129db9548df213/adapters/qq)：Koishi 4 对应的当前稳定接口。
- [qq-crack](https://github.com/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack/tree/c24d4aad38ffb7a37c457570cff11c993f6599c7)：原生私聊频道及媒体路由。

Satori 主分支的下一代运行时不等同于 Koishi 4 的适配器版本；本兼容层不要求升级至该运行时。
