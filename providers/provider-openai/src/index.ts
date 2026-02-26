import { createOpenAI } from "@ai-sdk/openai";
import {
  AbstractProvider,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";
import type { Context } from "koishi";

export default class OpenAIProvider extends AbstractProvider<
  ReturnType<typeof createOpenAI>,
  OpenAIProvider.Config
> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "openai";

  protected createClient(config: OpenAIProvider.Config) {
    return createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

namespace OpenAIProvider {
  export type Config = NonNullable<
    ReturnType<(typeof OpenAIProvider.Config)["parse"]>
  >;
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
  });
}
