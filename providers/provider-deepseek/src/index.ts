import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  AbstractProvider,
  type BaseProviderConfig,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";
import type { Context } from "koishi";

class DeepSeekProvider extends AbstractProvider<
  ReturnType<typeof createDeepSeek>,
  BaseProviderConfig
> {
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
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "deepseek-reasoner",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text],
      },
    ],
  });
}

export default DeepSeekProvider;
