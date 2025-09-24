import { readFileSync } from "fs";
import path from "path";

import { PROMPTS_DIR, TEMPLATES_DIR } from "@/shared/constants";

export function loadPrompt(name: string, ext: string = "txt") {
    try {
        const fullPath = path.resolve(PROMPTS_DIR, `${name}.${ext}`);
        return readFileSync(fullPath, "utf-8");
    } catch (error: any) {
        //this._logger.error(`加载提示词失败 "${name}.${ext}": ${error.message}`);
        // 返回一个包含错误信息的模板，便于调试
        // return `<!-- Error loading prompt: ${name} -->`;
        throw new Error(`Failed to load prompt: ${name}.${ext}`);
    }
}

export function loadTemplate(name: string, ext: string = "mustache") {
    try {
        const fullPath = path.resolve(TEMPLATES_DIR, `${name}.${ext}`);
        return readFileSync(fullPath, "utf-8");
    } catch (error: any) {
        //this._logger.error(`加载模板失败 "${name}.${ext}": ${error.message}`);
        // 返回一个包含错误信息的模板，便于调试
        // return `{{! Error loading template: ${name} }}`;
        throw new Error(`Failed to load template: ${name}.${ext}`);
    }
}

export * from "./config";
export * from "./renderer";
export * from "./service";
