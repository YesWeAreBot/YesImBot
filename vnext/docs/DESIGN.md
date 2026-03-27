1.  使用pi-agent或者ai-sdk agent特化agent工作流，不手动实现loop

2.  agent session按频道隔离，使用agent session state持久化，不再使用horizon编排上下文

3.  agent session绑定唯一频道，预先发现频道特定能力（发送消息、获取成员信息、群管功能、互动功能），不再依赖Capability驱动

4.  agent session不考虑跨频道，只能访问当前频道上下文；不同频道通过A2A、事件或者消息通信

5.  设计不同agent：

channel|chat|main agent
主agent，负责在各个频道和用户交流，也是目前已实现agent的主要功能

heartbeat|arousal agent
后台agent，负责监控所有main agent状态，处理定时heartbeat任务，可以配置
heartbeat agent可以读取不同main agent的状态（上次回复时间、最新消息、活跃群组等），并向对应main agent发出heartbeat|arousal事件
实现主动唤醒功能，效果是bot可以主动发消息以主动关怀、可以挑选感兴趣但被规则跳过的话题进行回复，防止冷场
可以实现定时任务，配合日程工具实现定时提醒功能

knowledge|memory agent
后台agent，负责管理知识库和记忆库，可以配置
knowledge agent可以提供接口供main agent查询知识库和记忆库
可以实现知识库的自动更新和维护功能，以及上下文窗口压缩

6.  agent session状态管理
    不手动管理messages列表，每次交互都是追加消息
    使用JSONL存储持久化

7.  每个频道绑定唯一session_id，分配唯一agent

8.  不再使用horizon listener监听和记录事件，不再使用event manager辅助查询timeline
    listener接收到消息后，即时写入对应的agent session

9.  使用意愿驱动和LLM辅助意愿判断，接收到新事件判断是否回复
    使用agent.continue触发响应流程

10. 若当前agent正在响应中又触发了新的响应请求，在turn_end后追加新消息
    若单次响应超时，使用agent.abort()终止请求，等待下次触发或者立即恢复

11. 工具执行
    重构当前工具执行机制，当前要求智能体输出JSON文本，解析后执行工具
    改为原生tool_call
    不再通过send_message工具发送消息，也不支持向其他频道发送消息，所有消息都发送至当前频道
    模型生成的文本内容都作为消息发送，但仍然支持消息元素和分段
    模型可以使用INNER_THOUGHTS标记内部思考文本，这些文本不会发送到频道

需要探索的是，模型生成文本和生成工具调用是否有先后顺序，能否先生成文本告知用户，再调用工具
当模型仅输出文本，根据规范本轮响应应该结束，但是模型仍然需要下一步行动应该如何处理

是否仍然保留部分格式化输出执行工具的能力，当前工具分为Action和Tool，Action一般没有返回值，或返回值不重要，当智能体执行Action后，若成功，则不需要再次调用LLM汇报执行结果
将Action执行方式保留为格式化文本输出，可以增强工具执行灵活性，同时减少延迟和调用成本

原生tool_call是否支持并发执行，即一次响应生成多个工具调用

12. 事件和消息通信

13. 上下文截断和压缩
    保留现状，软裁剪和硬裁剪结合，summary摘要

14. 使用AGENTS.md、SOUL.md、USER.md、MEMORY.md、TOOLS.md等文档持久化记忆，自定义agent。
    这些文件在每个session初始化时自动注入
    每个块附加最后更新时间，并在过期后主动提醒agent更新
    不同频道的agent共享这些内容，需要添加锁防止并行更新
    每个块附加上次更新者信息（channel，agent_id）
    每个块有预算上限，超出部分截断
