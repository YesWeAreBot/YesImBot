import {
  deepMergeSettings,
  type AthenaSessionSettings,
  SettingsManager,
} from "../../src/services/session/settings-manager";

const BASE_TEST_SETTINGS: AthenaSessionSettings = {
  model: "test:model",
  prompts: {
    builtInInstructions: "test instructions",
  },
};

export function createTestSettingsManager(overrides: AthenaSessionSettings = {}): SettingsManager {
  return new SettingsManager({
    globalSettingsPath: "/tmp/athena-test-global-settings.json",
    channelSettingsPath: "/tmp/athena-test-channel-settings.json",
    defaults: deepMergeSettings(BASE_TEST_SETTINGS, overrides),
  });
}
