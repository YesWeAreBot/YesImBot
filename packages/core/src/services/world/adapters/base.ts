import type { Context } from "koishi";
import type { HistoryConfig } from "@/services/world/config";
import type { EventRecorder } from "@/services/world/recorder";
import type { AnyPercept, Entity, Environment, Observation } from "@/services/world/types";

/**
 * 场景适配器基类
 *
 * 负责将场景特定的数据转换为通用的 WorldState 抽象
 */
export abstract class SceneAdapter {
    /** 适配器名称 */
    abstract name: string;

    constructor(
        protected ctx: Context,
        protected config: HistoryConfig,
        protected recorder: EventRecorder,
    ) {}

    /**
     * 判断此适配器是否可以处理给定的感知数据
     */
    abstract canHandle(percept: AnyPercept): boolean;

    /**
     * 构建环境信息
     */
    abstract buildEnvironment(percept: AnyPercept): Promise<Environment>;

    /**
     * 构建实体列表
     */
    abstract buildEntities(percept: AnyPercept, env: Environment): Promise<Entity[]>;

    /**
     * 构建事件历史
     */
    abstract buildEventHistory(percept: AnyPercept, env: Environment): Promise<Observation[]>;

    /**
     * 构建场景特定的扩展数据
     */
    abstract buildExtensions(percept: AnyPercept, env: Environment): Promise<Record<string, any>>;
}
