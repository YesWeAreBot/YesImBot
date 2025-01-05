/**
 * 生成工具模板
 *
 * https://platform.openai.com/docs/guides/function-calling
 * https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
 * @param ext
 * @returns
 */
export function getToolSchema(ext: Extension): ToolSchema {
  return {
    type: "function",
    function: {
      name: ext.name,
      description: ext.description,
      parameters: {
        type: "object",
        properties: ext.params,
        // 如果有默认值则非必填
        required: Object.entries(ext.params).map(([key, value]) => value.default ? null : key).filter(Boolean),
      },
    },
  };
}

/**
 * 以文本形式给出的工具模板
 * @param ext
 */
export function getFunctionPrompt(ext: Extension): string {
  let lines = [];
  lines.push(`${ext.name}:`);
  lines.push(`  description: ${ext.description}`);
  lines.push(`  params:`);
  Object.entries(ext.params).forEach(([key, value]) => {
    lines.push(`    ${key}: ${value.description}`);
  })
  return lines.join("\n");
}
