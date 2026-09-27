import type { Tool, ToolExecuteOptions } from "@xsai/shared-chat";
import type { HorizonService, Percept } from "@/services/horizon";
import type { FunctionContext, PluginService, ToolResult } from "@/services/plugin";
import { Random } from "koishi";
import { TimelineEventType, TimelinePriority, TimelineStage } from "@/services/horizon";
import { FunctionType } from "@/services/plugin";

/** 单次心跳的执行状态。原生调用与旧 JSON 动作共享顺序、去重及记录逻辑。 */
export class ToolExecution {
    public started = false;
    public hasTool = false;
    public hasAction = false;
    private readonly pending: Array<{ name: string; params: unknown; options: ToolExecuteOptions }> = [];
    private tail: Promise<unknown> = Promise.resolve();
    private readonly calls = new Map<string, { signature: string; result: Promise<ToolResult> }>();

    constructor(
        private readonly plugin: PluginService,
        private readonly horizon: HorizonService,
        private readonly context: FunctionContext,
        private readonly percept: Percept,
        private readonly signal: AbortSignal,
    ) {}

    public wrap(tools: Tool[]): Tool[] {
        return tools.map(tool => ({
            ...tool,
            execute: (params, options) => {
                // SDK 并发解析调用；整批成功前只收集，避免坏调用旁边的动作先产生副作用。
                this.pending.push({ name: tool.function.name, params, options });
                return {};
            },
        }));
    }

    public async executePending(): Promise<void> {
        for (const call of this.pending)
            await this.enqueue(call.name, call.params, call.options);
    }

    public enqueue(name: string, params: unknown, options?: ToolExecuteOptions): Promise<ToolResult> {
        if (!params || typeof params !== "object" || Array.isArray(params))
            return Promise.reject(new Error(`工具 ${name} 的参数必须是对象`));
        const args = params as Record<string, unknown>;
        const callId = options?.toolCallId;
        const signature = JSON.stringify([name, params]);
        const existing = callId && this.calls.get(callId);
        if (existing) {
            if (existing.signature !== signature)
                return Promise.reject(new Error("同一工具调用 ID 对应了不同的参数"));
            return existing.result;
        }
        const result = this.tail.then(() => this.execute(name, args, callId));
        this.tail = result;
        // SDK 可能在另一个调用校验失败时提前返回，队列仍需由 drain 收尾。
        void result.catch(() => {});
        if (callId)
            this.calls.set(callId, { signature, result });
        return result;
    }

    public async drain(): Promise<void> {
        await this.tail;
    }

    private async execute(name: string, params: Record<string, unknown>, callId?: string): Promise<ToolResult> {
        this.signal.throwIfAborted();
        const definition = await this.plugin.getFunction(name, this.context);
        if (!definition)
            throw new Error(`工具不可用: ${name}`);
        this.signal.throwIfAborted();
        // 从这里开始可能已产生外部效果，后续失败不得重新请求模型来重放调用。
        this.started = true;
        const result = await this.plugin.invoke(name, params, this.context);
        const isTool = definition.type === FunctionType.Tool;
        this.hasTool ||= isTool;
        this.hasAction ||= !isTool;
        // 无论成败都记录到事件线：失败的 ToolResult 会进入下一轮工作记忆，
        // 让模型看到失败原因后决定下一步（与 legacy 的 observation 回流一致）。
        await this.horizon.events.record({
            id: Random.id(),
            timestamp: new Date(),
            scope: this.percept.scope,
            priority: TimelinePriority.Normal,
            type: isTool ? TimelineEventType.AgentTool : TimelineEventType.AgentAction,
            stage: TimelineStage.Active,
            data: { name, args: params },
        });
        if (isTool) {
            await this.horizon.events.record({
                id: Random.id(),
                timestamp: new Date(),
                scope: this.percept.scope,
                priority: TimelinePriority.Normal,
                type: TimelineEventType.ToolResult,
                stage: TimelineStage.Active,
                data: { toolCallId: callId, status: result.status, result: result.result, error: result.error },
            });
        }
        if (result.status !== "success") {
            // 工具失败：返回结果并续心跳，模型能看到失败原因继续处理；
            // 动作失败：结束回合（hasAction 已置位），避免重放副作用。
            if (isTool)
                return result;
            throw new Error(`动作 ${name} 执行失败: ${String(result.error ?? "未知错误")}`);
        }
        return result;
    }
}
