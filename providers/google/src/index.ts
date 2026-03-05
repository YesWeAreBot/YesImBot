import { createGoogleGenerativeAI, GoogleGenerativeAIProvider as Provider } from "@ai-sdk/google";
import {
  AbstractProvider,
  type BaseProviderConfig,
  createProviderSchema,
  Modality,
} from "@yesimbot/shared-model";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

class GoogleProvider extends AbstractProvider<Provider, BaseProviderConfig> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "google";

  protected createClient(config: BaseProviderConfig) {
    return createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

namespace GoogleProvider {
  export type Config = BaseProviderConfig;
  export const Config = createProviderSchema({
    defaultId: "google",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: [
      {
        id: "gemini-3.1-pro-preview",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "gemini-3-pro-preview",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "gemini-3-flash-preview",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "gemini-2.5-pro",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "gemini-2.5-flash",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text, Modality.Image],
      },
    ],
  }).i18n({
    "zh-CN": zhCN._config,
    "en-US": enUS._config,
  });
}

export default GoogleProvider;
