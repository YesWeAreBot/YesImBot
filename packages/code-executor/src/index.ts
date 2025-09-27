import { Context, Logger } from "koishi";
import { Extension, ToolService } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";

import { Config } from "./config";
import { CodeExecutor } from "./executors/base";
import { PythonExecutor } from "./executors/python";

@Extension({
    name: "code-executor",
    display: "多引擎代码执行器",
    description: "提供一个可插拔的、支持多种语言的安全代码执行环境。",
    author: "AI-Powered Design",
    version: "2.0.0",
})
export default class MultiEngineCodeExecutor {
    static readonly inject = [Services.Tool, Services.Asset];
    static readonly Config = Config;
    private readonly logger: Logger;
    private executors: CodeExecutor[] = [];

    private toolService: ToolService;

    constructor(
        public ctx: Context,
        public config: Schemastery.TypeS<typeof Config>
    ) {
        this.logger = ctx.logger("code-executor");
        this.toolService = ctx[Services.Tool];

        this.ctx.on("ready", () => {
            this.initializeEngines();
        });

        this.ctx.on("dispose", () => {
            this.unregisterAllTools();
        });
    }

    private initializeEngines() {
        this.logger.info("Initializing code execution engines...");
        const engineConfigs = this.config.engines;

        // if (engineConfigs.javascript.enabled) {
        //     this.registerExecutor(new JavaScriptExecutor(this.ctx, engineConfigs.javascript, this.config.shared));
        // }

        // 2. Python Engine
        if (engineConfigs.python.enabled) {
            this.registerExecutor(new PythonExecutor(this.ctx, engineConfigs.python, this.config.shared));
        }
    }

    private registerExecutor(executor: CodeExecutor) {
        try {
            const toolDefinition = executor.getToolDefinition();
            this.toolService.registerTool(toolDefinition);
            this.executors.push(executor);
            this.logger.info(`Successfully registered tool: ${toolDefinition.name}`);
        } catch (error: any) {
            this.logger.warn(`Failed to register tool for engine '${executor.type}':`, error);
        }
    }

    private unregisterAllTools() {
        for (const executor of this.executors) {
            const toolName = executor.getToolDefinition().name;
            this.toolService.unregisterTool(toolName);
        }
        this.executors = [];
    }
}
