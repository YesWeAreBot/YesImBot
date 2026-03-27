import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

async function testCodingAgent() {
  console.log("Testing coding agent setup...");

  // 自定义路径
  const customAgentDir = "/home/workspace/Athena/vnext/tests/.athena/agent";
  const customCwd = "/home/workspace/Athena/vnext/tests";

  // 1. 自定义认证存储（不使用 ~/.pi/agent/auth.json）
  const authStorage = AuthStorage.create(`${customAgentDir}/auth.json`);

  // 2. 自定义模型注册表（不使用 ~/.pi/agent/models.json）
  const modelRegistry = new ModelRegistry(authStorage, `${customAgentDir}/models.json`);

  // 3. 自定义设置管理器（不使用 ~/.pi/agent/settings.json 和 .pi/settings.json）
  const settingsManager = SettingsManager.inMemory({
    // 在这里设置所有需要的配置
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 3 },
  });

  // 4. 自定义会话管理器（不使用 ~/.pi/agent/sessions/）
  const sessionManager = SessionManager.create(customCwd, `${customAgentDir}/sessions`);

  // 5. 自定义资源加载器（不发现 ~/.pi/agent 和 .pi 中的资源）
  const resourceLoader = new DefaultResourceLoader({
    cwd: customCwd,
    agentDir: customAgentDir,
    settingsManager,
    // 禁用所有默认资源发现
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [], diagnostics: [] }),
  });
  await resourceLoader.reload();

  // 6. 创建会话
  const { session } = await createAgentSession({
    cwd: customCwd,
    agentDir: customAgentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    resourceLoader,
  });

  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  modelRegistry.registerProvider("yunwu", {
    apiKey: "",
    api: "openai-completions",
    baseUrl: "https://yunwu.ai/v1",
    models: [
      {
        id: "gpt-5.2-chat",
        name: "GPT-5.2",
        reasoning: true,
        input: ["image", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 8000,
      },
    ],
  });

  const model = modelRegistry.find("yunwu", "gpt-5.2-chat");
  if (!model) {
    throw new Error("Model not found in registry");
  }
  console.log(`Using model: ${model.name}`);

  await session.setModel(model);
  console.log("Model set successfully");

  await session.prompt("Hello, agent! tell me a joke.");

  console.log();
}

testCodingAgent().catch((error) => {
  console.error("Error testing coding agent:", error);
});
