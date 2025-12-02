import type { Context, Session } from "koishi";
import type { PromptService } from "koishi-plugin-yesimbot/services";
import { Schema } from "koishi";
import { Action, Failed, Metadata, Plugin, Success, Tool, withInnerThoughts } from "koishi-plugin-yesimbot/services/plugin";
import { Services } from "koishi-plugin-yesimbot/shared";

// --- 配置项接口定义 ---
export interface FavorSystemConfig {
    maxFavor: number;
    initialFavor: number;
    stage: { threshold: number; description: string }[];
}

// --- 数据库表接口定义 ---
declare module "koishi" {
    interface Tables {
        favor: FavorTable;
    }
}

export interface FavorTable {
    user_id: string;
    amount: number;
}

/**
 * 一个用于管理用户好感度的扩展。
 * 提供了增加、设置好感度的工具，并能将好感度数值和阶段作为信息片段注入到 AI 的提示词中。
 */
@Metadata({
    name: "favor",
    display: "好感度管理",
    description: "管理用户的好感度，并提供相应的状态描述。可通过 `{{roleplay.favor}}` 和 `{{roleplay.state}}` 将信息注入提示词。",
})
export default class FavorExtension extends Plugin<FavorSystemConfig> {
    // --- 静态配置 ---
    static readonly Config: Schema<FavorSystemConfig> = Schema.object({
        initialFavor: Schema.number().default(20).description("新用户的初始好感度。"),
        maxFavor: Schema.number().default(100).description("好感度的最大值。"),
        stage: Schema.array(
            Schema.object({
                threshold: Schema.number().description("好感度阈值"),
                description: Schema.string()
                    .role("textarea", { rows: [2, 4] })
                    .description("阶段描述"),
            }),
        )
            .default([])
            .description("好感度阶段配置。系统会自动匹配，其描述将通过 `{{roleplay.state}}` 片段提供给 AI。"),
    });

    // --- 依赖注入 ---
    static readonly inject = ["database", Services.Prompt, Services.Plugin];

    constructor(ctx: Context, config: FavorSystemConfig) {
        super(ctx, config);
        this.logger = ctx.logger("favor-extension");

        // 扩展数据库模型
        this.ctx.model.extend(
            "favor",
            {
                user_id: "string",
                amount: "integer",
            },
            { primary: "user_id", autoInc: false },
        );

        // 在 onMount 中执行异步初始化逻辑
        this.ctx.on("ready", () => this.onMount());
    }

    /**
     * 扩展挂载时的生命周期钩子
     */
    private async onMount() {
        // 对好感度阶段按阈值降序排序，确保匹配逻辑正确
        this.config.stage.sort((a, b) => b.threshold - a.threshold);
        this.logger.info("好感度阶段已排序");

        this.ctx.scope.update(this.config, false);

        // 注入 Koishi 的 Prompt 服务 (来自 yesimbot)
        const promptService: PromptService = this.ctx[Services.Prompt];

        promptService.inject("roleplay.favor", 10, async (context) => {
            this.ctx.logger.info("渲染好感度注入片段");
            const { session } = context;
            // 仅在私聊中注入好感度信息
            if (!(session as Session)?.isDirect)
                return "";
            const favorEntry = await this._getOrCreateFavorEntry(session.userId);
            const stageDescription = this._getFavorStage(favorEntry.amount);
            return `## 好感度设定
当前你与用户 ${session.username} (ID: ${session.userId}) 的好感度为 ${favorEntry.amount}，关系阶段是：${stageDescription}。
请时刻参考这些信息，并根据当前的好感度和关系阶段，以合适的语气和内容与用户互动。`;
        });

        promptService.registerSnippet("roleplay.config.maxFavor", () => this.config.maxFavor);

        this.logger.info("好感度系统扩展已加载。");
    }

    // --- AI 可用工具 ---

    @Action({
        name: "add_favor",
        description: "为指定用户增加或减少好感度",
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要增加好感度的用户 ID"),
            amount: Schema.number().required().description("要增加的好感度数量。负数则为减少。"),
        }),
    })
    async addFavor(params: { user_id: string; amount: number }) {
        const { user_id, amount } = params;
        try {
            await this.ctx.database.get("favor", { user_id }).then((res) => {
                if (res.length > 0) {
                    const newAmount = this._clampFavor(res[0].amount + amount);
                    this.ctx.database.set("favor", { user_id }, { amount: newAmount });
                } else {
                    const newAmount = this._clampFavor(this.config.initialFavor + amount);
                    this.ctx.database.create("favor", { user_id, amount: newAmount });
                }
            });
            this.logger.info(`为用户 ${user_id} 调整了 ${amount} 点好感度。`);
            return Success(`成功为用户 ${user_id} 调整了 ${amount} 点好感度。`);
        } catch (error: any) {
            this.logger.error(`为用户 ${user_id} 增加好感度失败:`, error);
            return Failed(`为用户 ${user_id} 增加好感度失败：${error.message}`);
        }
    }

    @Tool({
        name: "set_favor",
        description: "为指定用户直接设置好感度。上限为 {{ roleplay.config.maxFavor }}。",
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要设置好感度的用户 ID"),
            amount: Schema.number().required().description("要设置的好感度目标值。"),
        }),
    })
    async setFavor(params: { user_id: string; amount: number }) {
        const { user_id, amount } = params;

        try {
            const finalAmount = this._clampFavor(amount);
            await this.ctx.database.upsert("favor", [{ user_id, amount: finalAmount }]);
            this.logger.info(`将用户 ${user_id} 的好感度设置为 ${finalAmount}。`);
            return Success(`成功将用户 ${user_id} 的好感度设置为 ${finalAmount}。`);
        } catch (error: any) {
            this.logger.error(`为用户 ${user_id} 设置好感度失败:`, error);
            return Failed(`为用户 ${user_id} 设置好感度失败：${error.message}`);
        }
    }

    // --- 私有辅助方法 ---

    /**
     * 获取或创建指定用户的好感度记录。
     * @param user_id 用户ID
     * @returns 对应的好感度数据库条目
     */
    private async _getOrCreateFavorEntry(user_id: string): Promise<FavorTable> {
        const result = await this.ctx.database.get("favor", { user_id });
        if (result.length > 0) {
            return result[0];
        }
        // 如果不存在，则创建并返回初始记录
        const newEntry: FavorTable = { user_id, amount: this.config.initialFavor };
        await this.ctx.database.create("favor", newEntry);
        this.logger.info(`为新用户 ${user_id} 创建了好感度记录，初始值为 ${this.config.initialFavor}。`);
        return newEntry;
    }

    /**
     * 根据好感度数值获取对应的阶段描述。
     * @param amount 好感度数值
     * @returns 阶段描述字符串
     */
    private _getFavorStage(amount: number): string {
        // 由于 config.stage 已在 onMount 中按阈值降序排序，第一个匹配到的就是最高级的阶段
        for (const { threshold, description } of this.config.stage) {
            if (amount >= threshold) {
                return description;
            }
        }
        // 如果配置文件为空或者有问题，提供一个默认的回退值
        return "未知的关系阶段";
    }

    /**
     * 将好感度数值限制在 [0, maxFavor] 的范围内。
     * @param amount 原始好感度值
     * @returns 修正后的好感度值
     */
    private _clampFavor(amount: number): number {
        return Math.max(0, Math.min(amount, this.config.maxFavor));
    }
}
