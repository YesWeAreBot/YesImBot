import { GenerateTextResult } from "@xsai/generate-text";
import { Message } from '@xsai/shared-chat';
import { StreamTextResult } from "@xsai/stream-text";
import { ToolResult } from '@xsai/tool';

import { Config } from "../config";
import logger from "../utils/logger";
import { LLM } from "./config";


export abstract class BaseAdapter {
    protected readonly baseURL: string;
    protected readonly apiKey: string;
    protected readonly model: string;
    protected readonly otherParams: Record<string, any>;
    readonly ability: ("原生工具调用" | "识图功能" | "结构化输出" | "流式输出" | "深度思考" | "对话前缀续写")[];

    protected startWith?: string;

    constructor(
        protected adapterConfig: LLM,
        protected parameters?: Config["Parameters"]
    ) {
        const { APIKey, APIType, AIModel, Ability } = adapterConfig;
        this.baseURL = adapterConfig.BaseURL;
        this.apiKey = APIKey;
        this.model = AIModel;
        this.ability = Ability || [];

        // 解析其他参数
        this.otherParams = {};
        if (this.parameters?.OtherParameters) {
            Object.entries(this.parameters.OtherParameters).forEach(([key, value]) => {
                const trimmedKey = key.trim();
                const trimmedValue = typeof value === 'string' ? value.trim() : value;

                let parsedValue = trimmedValue;
                // 尝试解析 JSON 字符串
                if (typeof trimmedValue === 'string') {
                    try {
                        parsedValue = JSON.parse(trimmedValue);
                    } catch (e) {
                        // 如果解析失败，保持原值
                    }
                }

                // 转换 value 为适当的类型
                switch (parsedValue) {
                    case 'true':
                        this.otherParams[trimmedKey] = true;
                        break;
                    case 'false':
                        this.otherParams[trimmedKey] = false;
                        break;
                    default:
                        if (typeof parsedValue === 'boolean') {
                            this.otherParams[trimmedKey] = parsedValue;
                            //@ts-ignore
                        } else if (!isNaN(parsedValue)) {
                            this.otherParams[trimmedKey] = Number(parsedValue);
                        } else {
                            this.otherParams[trimmedKey] = parsedValue;
                        }
                }
            });
        }
        logger.info(`Adapter: ${APIType} registered`);
    }

    abstract chat(messages: Message[], tools?: ToolResult[], debug?: Boolean): Promise<GenerateTextResult>;
}
