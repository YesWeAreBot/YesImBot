// --- Agent 响应结构 (ReAct Pattern) ---

/**
 * 代表 Agent 在 ReAct 循环中的一个完整步骤 (Thought -> Action -> Observation)。
 */
export interface AgentResponse {
    /**
     * 思考过程 (Thought): Agent 的内心独白。
     * - `observe`: 对当前情景的观察和总结。
     * - `analyze_infer`: 分析观察结果，进行推理。
     * - `plan`: 基于分析和推理，制定下一步行动计划。
     */
    thoughts: { observe: string; analyze_infer: string; plan: string };
    /**
     * 行动 (Action): Agent 决定执行的一个或多个具体动作。
     */
    actions: Action[];
    /**
     * 观察 (Observation): 执行动作后从环境中获得的结果。
     * 这个结果将成为下一个 `AgentResponse` 中 `thoughts.observe` 的输入。
     */
    observations: ActionResult[];
    /**
     * 是否请求心跳。
     * 若为 true，表示 Agent 希望立即进入下一个处理循环，即使没有新的外部事件。
     * 用于需要连续执行多步操作的场景。
     */
    request_heartbeat: boolean;
}

/**
 * 定义了一个 Agent 可以执行的动作。
 */
export interface Action {
    /** 要调用的函数或工具的名称。 */
    function: string;
    /** 调用函数时传入的参数。 */
    params: Record<string, unknown>;
}

/**
 * 定义了一个动作执行后的结果。
 */
export interface ActionResult {
    /** 执行的函数名称，与 `Action.function` 对应。 */
    function: string;
    /** 函数执行的返回结果。 */
    status: "success" | "failed" | string;
    result?: any;
    error?: any;
}
