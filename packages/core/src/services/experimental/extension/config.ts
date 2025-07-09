import { Schema } from "koishi";

export interface ToolServiceConfig {}

export const ToolServiceConfigSchema = Schema.object({
    extensionConfigs: Schema.dynamic("toolService.availableExtensions"),
});
