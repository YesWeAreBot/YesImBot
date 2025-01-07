import { Schema } from "koishi";

export interface Config {
  Debug: boolean;
}

export const Config: Schema<Config> = Schema.object({
  Debug: Schema.boolean().default(false).description("调试模式")
});
