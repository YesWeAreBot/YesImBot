import { createDeepSeek, DeepSeekProvider as Provider } from "@ai-sdk/deepseek";
import {
  AbstractProvider,
  type BaseProviderConfig,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

class DeepSeekProvider extends AbstractProvider<Provider, BaseProviderConfig> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "deepseek";

  protected createClient(config: BaseProviderConfig) {
    return createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

namespace DeepSeekProvider {
  export type Config = BaseProviderConfig;
  export const Config = createProviderSchema({
    defaultId: "deepseek",
    defaultBaseURL: "https://api.deepseek.com/v1",
    defaultModels: [
      {
        id: "deepseek-chat",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text],
      },
      {
        id: "deepseek-reasoner",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text],
      },
    ],
  }).i18n({
    "zh-CN": zhCN._config,
    "en-US": enUS._config,
  });
}

export default DeepSeekProvider;
