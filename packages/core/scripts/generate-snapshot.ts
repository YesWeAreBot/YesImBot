import { writeFileSync } from "fs";
import path from "path";
//@ts-ignore
import { Project, PropertySignature } from "ts-morph";

// --- 配置区 ---
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TSCONFIG_PATH = path.resolve(PROJECT_ROOT, "tsconfig.json");
const CONFIG_FILE_PATH = path.resolve(PROJECT_ROOT, "src/config/config.ts");
const TARGET_TYPE_NAME = "Config";
const NEW_INTERFACE_NAME = "ConfigV200";
// --- 结束配置 ---

async function generateConfigSnapshot() {
    const project = new Project({
        tsConfigFilePath: TSCONFIG_PATH,
    });

    const sourceFile = project.getSourceFileOrThrow(CONFIG_FILE_PATH);

    const targetTypeAlias = sourceFile.getTypeAlias(TARGET_TYPE_NAME);

    if (!targetTypeAlias) {
        console.error(`错误：在文件 ${CONFIG_FILE_PATH} 中找不到类型别名 'export type ${TARGET_TYPE_NAME}'`);
        return;
    }

    const resolvedType = targetTypeAlias.getType();

    let output = "";

    output += `/**\n`;
    output += ` * ${NEW_INTERFACE_NAME} - 由脚本自动生成的配置快照\n`;
    output += ` * 来源: ${TARGET_TYPE_NAME} in ${path.basename(CONFIG_FILE_PATH)}\n`;
    output += ` * 生成时间: ${new Date().toISOString()}\n`;
    output += ` */\n`;
    output += `export interface ${NEW_INTERFACE_NAME} {\n`;

    const properties = resolvedType.getProperties();

    if (properties.length === 0) {
        console.error("错误：未能解析出任何属性。请检查 tsconfig.json 路径是否正确，以及路径别名（paths）是否配置。");
        return;
    }

    for (const prop of properties) {
        const propName = prop.getName();

        const declaration = prop.getDeclarations()[0];
        if (!declaration) continue;

        const jsDocs = (declaration as PropertySignature).getJsDocs?.();
        const lastJsDoc = jsDocs?.[jsDocs.length - 1];
        const comment = lastJsDoc?.getCommentText()?.trim();

        if (comment) {
            output += `\n    /**\n`;
            output += `     * ${comment.split("\n").join("\n     * ")}\n`;
            output += `     */\n`;
        }

        const typeText = (declaration as PropertySignature).getTypeNodeOrThrow().getText();

        const isOptional = (declaration as PropertySignature).hasQuestionToken?.();
        const isReadonly = (declaration as PropertySignature).isReadonly?.();

        output += `    ${isReadonly ? "readonly " : ""}${propName}${isOptional ? "?" : ""}: ${typeText};\n`;
    }

    output += `}\n`;

    console.log("--- 自动生成的配置快照 ---");
    console.log(output);
    console.log("\n--- 将以上代码复制到您的 versions.ts 文件中 ---");

    writeFileSync(path.resolve(PROJECT_ROOT, "src/config/versions/v200.ts"), output);
}

generateConfigSnapshot().catch((error) => {
    console.error("脚本执行失败：", error);
});
