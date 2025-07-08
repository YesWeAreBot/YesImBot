import { Schema } from "koishi";
import { JsonParser } from "../../../shared";
import { TaskType } from "../../model";
import { Services } from "../../types";
import { createExtension, createTool, Failed, Success } from "../helpers";
import { ToolExecutionContext } from "../types";

const metadata = {
    name: "Creator",
    version: "1.0.0",
    description: "使用LLM动态创建工具",
    author: "MiaowFISH",
};

const TOOL_CREATOR_SYSTEM_PROMPT = `
You are an expert TypeScript developer tasked with creating tools for an AI agent.
Your goal is to generate a single, clean, valid JSON object that defines a new tool.
The JSON object MUST conform to the following structure:
{
  "name": "string",
  "description": "string",
  "dependencies": ["string"],
  "parameters": "string",
  "execute": "string"
}

RULES:
1.  **JSON Format**: Your entire output must be a single JSON object. Do not include any text or markdown formatting.
2.  **dependencies (Optional)**: An array of npm package names required by your 'execute' logic (e.g., ["axios"]).
3.  **parameters**: A string containing a 'Schema.object({...})' definition.
4.  **execute**: A string containing the body of an \`async (ctx, params) => { ... }\` function.
    - **CRITICAL RETURN VALUE**: The function MUST return a JSON object that conforms to the 'ToolCallResult' interface.
      - On success, return: \`{ status: 'success', result: <your_data> }\`. The 'result' can be any JSON-serializable value (string, number, object).
      - On failure, return: \`{ status: 'failed', error: 'A descriptive error message.', retryable: false }\`. You can include 'metadata' for technical details.
    - **CRITICAL DEPENDENCIES**: To use a package from 'dependencies', access it via \`ctx.dependencies.package_name\`. DO NOT use \`require()\` or \`import\`.
    - Always use try-catch blocks for robust error handling.

ENVIRONMENT:
- You are running in a Node.js environment.
- The 'ctx' object provides:
  - \`ctx.logger\` for logging.
  - \`ctx.koishiContext\` for accessing the Koishi app context.
  - \`ctx.koishiSession\` for accessing the current Koishi session.
  - \`ctx.dependencies\` for accessing npm packages listed in 'dependencies'.

EXAMPLE:
User wants a tool to get the public IP address using an external service.
- Name: "get_public_ip"
- Description: "获取当前的公网IP地址。"
- Dependencies: Needs 'axios' to make an HTTP request.
- Parameters: No parameters needed.
- Logic: Call 'https://api.ipify.org?format=json' using axios.

Your expected output (a single raw JSON string):
{
  "name": "get_public_ip",
  "description": "使用 ipify.org API 获取当前的公网 IP 地址。",
  "dependencies": ["axios"],
  "parameters": "Schema.object({})",
  "execute": "async (ctx, params) => {\\n    const axios = ctx.dependencies.axios;\\n    try {\\n        ctx.logger.info('Fetching public IP address...');\\n        const response = await axios.get('https://api.ipify.org?format=json');\\n        const ip = response.data.ip;\\n        if (!ip) {\\n            return { status: 'failed', error: 'API response did not contain an IP address.', retryable: false };\\n        }\\n        return { status: 'success', result: { ip: ip } };\\n    } catch (error) {\\n        ctx.logger.error('Failed to fetch public IP:', error);\\n        return { status: 'failed', error: 'An error occurred while fetching the public IP address.', metadata: { details: error.message }, retryable: true };\\n    }\\n}"
}
`;

/**
 * 动态加载工具所需的外部依赖项。
 * @param packageNames - 需要加载的npm包名称列表。
 * @returns 一个对象，键为包名，值为包的导出内容。
 */
async function loadDependencies(packageNames: string[]): Promise<{ [key: string]: any }> {
    const dependencies: { [key: string]: any } = {};
    for (const name of packageNames) {
        try {
            dependencies[name] = await import(name);
        } catch (error) {
            console.error(`[ToolCreator] Critical error: Failed to load dependency '${name}'. Is it installed?`);
            throw new Error(`Dependency '${name}' could not be loaded. Please ensure it is installed in the agent's environment.`);
        }
    }
    return dependencies;
}

/**
 * 为工具动态生成可执行函数和参数Schema。
 * 此函数通过 new Function 安全地编译代码字符串，并允许注入外部依赖（如Schema构建器）。
 * @param paramsSchemaString - 代表`Schema.object({...})`的字符串。
 * @param executeLogicString - 代表`async (ctx, params) => {...}`函数体的字符串。
 * @param dependencies - 需要注入到编译环境的对象，键为变量名，值为对象本身。
 * @returns 包含可执行 parameters 和 execute 的对象。
 * @throws 如果代码字符串包含语法错误。
 */
function compileToolCode(
    paramsSchemaString: string,
    executeLogicString: string,
    dependencies: { [key: string]: any }
): { parameters: object; execute: Function } {
    // 注入依赖项以编译参数
    const { Schema } = dependencies;
    const parameters = eval(paramsSchemaString); // eval 用于 Schema 编译

    // 使用 eval 将完整的函数定义字符串转换为一个真正的函数对象
    const execute = eval(executeLogicString);

    if (typeof execute !== "function") {
        throw new Error("LLM-generated 'execute' string did not evaluate to a function.");
    }

    return { parameters, execute };
}

export const ToolCreator = createTool({
    name: "tool_creator",
    description: "根据用户需求，调用高级编码LLM来动态创建、验证并注册一个新工具。",
    parameters: Schema.object({
        name: Schema.string().description("要创建的工具的名称，应为唯一的、符合变量命名规范的字符串（例如 'weather_checker'）。"),
        description: Schema.string().description("对新工具功能的详细描述，说明它的作用。"),
        parametersDescription: Schema.string().description(
            "用自然语言描述新工具需要的参数。例如：'需要一个名为city的字符串参数表示城市，和一个可选的名为days的数字参数表示预测天数，默认为3'。"
        ),
        logicDescription: Schema.string().description(
            "用自然语言描述工具的核心执行逻辑。例如：'调用天气API获取指定城市和天数的天气预报，并以友好格式返回结果'。"
        ),
        lifecycle: Schema.union(["session", "permanent"])
            .description("工具的生命周期。'session'表示工具仅在当前会话有效，'permanent'表示工具将被保存到本地，并在下次启动时加载。")
            .default("session"),
        //maxRetries: Schema.number().description("当LLM生成代码失败时，最大尝试修正次数。").default(2),
        //timeout: Schema.number().description("调用LLM生成代码的超时时间（毫秒）。").default(30000),
    }),

    execute: async (ctx: ToolExecutionContext, { name, description, parametersDescription, logicDescription, lifecycle }) => {
        const { koishiContext, logger } = ctx;

        // TODO: 从配置读取
        const maxRetries = 2;
        const timeout = 30000;

        logger.info(`开始创建工具: ${name}`);

        // 1. 获取一个擅长编码的LLM
        const codeLLM = koishiContext[Services.Model].useChatGroup(TaskType.CodeGeneration)?.getCurrent();
        if (!codeLLM) {
            return Failed("没有可用的编码LLM模型。");
        }

        // 2. 构建系统提示词
        const systemPrompt = TOOL_CREATOR_SYSTEM_PROMPT;

        let lastError: string | null = null;
        let toolDefinition: any = null;

        // 3. 带重试和自动纠错的LLM调用循环
        for (let i = 0; i <= maxRetries; i++) {
            logger.info(`尝试创建工具... (Attempt ${i + 1}/${maxRetries + 1})`);

            const userPrompt = `
Please create a tool with the following specifications.
${lastError ? `PREVIOUS ATTEMPT FAILED. Please fix this error: ${lastError}` : ""}

- Tool Name: ${name}
- Tool Description: ${description}
- Tool Parameters (in natural language): ${parametersDescription}
- Tool Logic (in natural language): ${logicDescription}

Generate the complete JSON object now.
`;

            try {
                // 4. 超时控制
                const llmPromise = codeLLM.chat([
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ]);

                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("LLM call timed out")), timeout));

                const result: any = await Promise.race([llmPromise, timeoutPromise]);
                const rawContent = result.text.trim();

                // 5. 多层验证
                // 5.1. JSON 解析验证
                let parsedContent;
                try {
                    parsedContent = new JsonParser<any>().parse(rawContent).data || {};
                } catch (error) {
                    throw new Error(`Generated content is not valid JSON. Error: ${error.message}. Raw Content: "${rawContent}"`);
                }

                // 5.2. 结构验证
                if (!parsedContent.name || !parsedContent.description || !parsedContent.parameters || !parsedContent.execute) {
                    throw new Error(
                        `Generated JSON is missing required keys. Required: name, description, parameters, execute. Found: ${Object.keys(parsedContent).join(", ")}`
                    );
                }

                // 5.3. 代码语法验证
                compileToolCode(parsedContent.parameters, parsedContent.execute, { Schema: Schema });

                // 如果所有验证都通过
                toolDefinition = parsedContent;
                logger.info("✅ LLM生成代码成功并通过所有验证。");
                break;
            } catch (error) {
                lastError = error.message;
                logger.warn(`生成或验证失败 (Attempt ${i + 1}): ${lastError}`);
                logger.debug(error.stack);
                if (i === maxRetries) {
                    // ctx.on('finish', (res) => logger.error("最终工具创建失败。", res));
                    return Failed(`创建工具失败，已达最大重试次数。最后一次错误: ${lastError}`);
                }
            }
        }

        if (!toolDefinition) {
            return Failed("未知错误：工具定义未能成功创建。");
        }

        try {
            // 6. 工具实例化与注册
            const { parameters: execParams, execute: rawExecFunc } = compileToolCode(
                toolDefinition.parameters,
                toolDefinition.execute,
                { Schema: Schema }
            );

            // 2. 创建包含依赖注入逻辑的最终执行函数]
            const finalExecute = async (runtimeCtx: ToolExecutionContext, params: any) => {
                try {
                    const declaredDependencies = toolDefinition.dependencies || [];
                    const loadedDependencies = await loadDependencies(declaredDependencies);

                    const augmentedCtx = {
                        ...runtimeCtx,
                        dependencies: loadedDependencies,
                    };

                    return await rawExecFunc(augmentedCtx, params);
                } catch (error) {
                    logger.error(`[Tool:${toolDefinition.name}] Failed during dependency loading or execution:`, error);
                    return Failed(`Tool execution failed: ${error.message}`);
                }
            };

            const newTool = createTool({
                name: toolDefinition.name,
                description: toolDefinition.description,
                parameters: execParams as any,
                execute: finalExecute,
            });

            // 注册一个工具
            koishiContext["yesimbot.tool"].registerTool(newTool);
            logger.info(`✅ 工具 "${newTool.name}" 已成功注册。`);

            // 7. 生命周期管理
            // if (lifecycle === "permanent") {
            //     try {
            //         // 实际项目中，你可能需要一个更健壮的路径管理
            //         const toolsDir = path.resolve(process.cwd(), "data/tools");
            //         await fs.mkdir(toolsDir, { recursive: true });
            //         const filePath = path.join(toolsDir, `${newTool.name}.json`);
            //         // 保存的是LLM生成的原始字符串定义，以便下次可以重新编译
            //         await fs.writeFile(filePath, JSON.stringify(toolDefinition, null, 2));
            //         logger.info(`✅ 工具定义已保存到: ${filePath}`);
            //     } catch (error) {
            //         logger.error(`无法将工具保存到文件: ${error.message}`);
            //         // 即使保存失败，工具仍在当前会话中注册，所以只记录错误
            //     }
            // }

            // 8. 任务完成通知
            const successMessage = `工具 "${newTool.name}" 创建成功并已注册。生命周期: ${lifecycle}。`;
            // ctx.on('finish', (res) => logger.info(`任务完成: ${successMessage}`, res));
            return Success(successMessage);
        } catch (error) {
            logger.error(`在最终实例化或注册工具时发生错误: ${error.message}`);
            return Failed(`代码通过了初步验证，但在最终实例化时失败: ${error.message}`);
        }
    },
});

export default createExtension({
    metadata,
    tools: [ToolCreator],
});
