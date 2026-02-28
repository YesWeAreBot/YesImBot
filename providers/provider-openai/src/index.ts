import { createOpenAI } from "@ai-sdk/openai";
import {
  AbstractProvider,
  type BaseProviderConfig,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";
import type { Context } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

class OpenAIProvider extends AbstractProvider<ReturnType<typeof createOpenAI>, BaseProviderConfig> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "openai";

  protected createClient(config: BaseProviderConfig) {
    return createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

namespace OpenAIProvider {
  export type Config = BaseProviderConfig;
  export const Config = createProviderSchema({
    defaultId: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: [
      {
        id: "gpt-4o",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
    ],
  }).i18n({
    "zh-CN": zhCN._config,
    "en-US": enUS._config,
  });
}

export default OpenAIProvider;
