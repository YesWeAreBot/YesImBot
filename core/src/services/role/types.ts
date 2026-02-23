import { Schema } from "koishi";

export interface RoleServiceConfig {
  rolePath?: string;
}

export const RoleServiceConfigSchema: Schema<RoleServiceConfig> = Schema.object({
  rolePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
    "data/yesimbot/roles",
  ),
});
