import {
  Failed as coreFailed,
  Success as coreSuccess,
} from "koishi-plugin-yesimbot/services/plugin";

export {
  Action,
  defineAction,
  defineTool,
  FunctionType,
  Metadata,
  Tool,
  withInnerThoughts,
  YesImPlugin,
  type FunctionDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "koishi-plugin-yesimbot/services/plugin";
export { jsonSchemaToSchema, schemaToJSONSchema } from "koishi-plugin-yesimbot/services/plugin";

export function Success<T>(result?: T) {
  return coreSuccess(result);
}

export function Failed(error: string, metadata?: Record<string, unknown>) {
  return (
    coreFailed as (message: string, meta?: Record<string, unknown>) => ReturnType<typeof coreFailed>
  )(error, metadata);
}
