import { Schema } from "koishi";

export interface PersonaServiceConfig {
  rolePath?: string;
  debugLevel?: number;
}

export const PersonaServiceConfigSchema: Schema<PersonaServiceConfig> = Schema.object({
  rolePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
    "data/yesimbot/roles",
  ),
  debugLevel: Schema.number().min(0).max(3).step(1),
});

export type RoleServiceConfig = PersonaServiceConfig;
export const RoleServiceConfigSchema = PersonaServiceConfigSchema;
