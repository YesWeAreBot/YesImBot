import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  AbstractProvider,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";
import type { Context } from "koishi";

export default class DeepSeekProvider extends AbstractProvider<
  ReturnType<typeof createDeepSeek>,
  DeepSeekProvider.Config
> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "deepseek";

  protected createClient(config: DeepSeekProvider.Config) {
    return createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

namespace DeepSeekProvider {
  export type Config = NonNullable<
    ReturnType<(typeof DeepSeekProvider.Config)["parse"]>
  >;
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
