///<reference types="bun-types" />

import { expect, test, mock, beforeEach } from "bun:test";
import { Context } from "koishi";
import { PromptBuilder } from "../src/services/PromptBuilder";

// Mock services
const mockMemoryService = {
    getMemoryBlocks: mock(() =>
        Promise.resolve([
            {
                id: "test-memory-1",
                content: "测试记忆内容1",
                type: "core",
            },
            {
                id: "test-memory-2",
                content: "测试记忆内容2",
                type: "episodic",
            },
        ])
    ),
};

const mockToolManager = {
    getAvailableTools: mock(() => [
        {
            name: "test_tool",
            description: "测试工具",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "消息内容" },
                },
            },
        },
    ]),
};

const mockDataManager = {
    getCurrentTurn: mock(() =>
        Promise.resolve({
            id: "test-turn-id",
            messages: [
                {
                    role: "user",
                    content: "测试用户消息",
                    timestamp: new Date(),
                },
            ],
        })
    ),
};

const mockContext = {
    logger: (name: string) => ({
        info: mock(),
        warn: mock(),
        error: mock(),
        debug: mock(),
    }),
    "yesimbot.memory": mockMemoryService,
    "yesimbot.tool": mockToolManager,
    "yesimbot.data": mockDataManager,
    on: mock(),
} as any;

const mockAgentContext = {
    koishiContext: mockContext,
    koishiSession: {
        messageId: "test-message-id",
        userId: "test-user-id",
        channelId: "test-channel-id",
        content: "测试消息内容",
        author: {
            id: "test-user-id",
            name: "测试用户",
        },
    },
    platform: {
        name: "test-platform",
    },
    runLog: [],
};

test("PromptBuilder 应该正确初始化", () => {
    const config = {
        SystemTemplate: "测试系统模板 {{memory}} {{tools}}",
        UserTemplate: "测试用户模板 {{userContent}}",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    expect(promptBuilder).toBeDefined();
});

test("PromptBuilder 应该正确构建提示词", async () => {
    const config = {
        SystemTemplate: "系统提示词模板 {{memory}} {{tools}}",
        UserTemplate: "用户提示词模板 {{userContent}}",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    // 手动注册数据提供者（模拟初始化过程）
    promptBuilder.registerDataProvider("memory", async () => "测试记忆数据");
    promptBuilder.registerDataProvider("tools", async () => "测试工具数据");
    promptBuilder.registerDataProvider("userContent", async () => "测试用户内容");

    const result = await promptBuilder.build(mockAgentContext);

    expect(result).toBeDefined();
    expect(result.system).toContain("系统提示词模板");
    expect(result.user).toBeDefined();
    expect(Array.isArray(result.user)).toBe(true);
});

test("PromptBuilder 应该正确处理 Mustache 模板", async () => {
    const config = {
        SystemTemplate: "Hello {{name}}, you have {{count}} messages",
        UserTemplate: "User: {{message}}",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    // 注册测试数据提供者
    promptBuilder.registerDataProvider("name", async () => "Alice");
    promptBuilder.registerDataProvider("count", async () => 5);
    promptBuilder.registerDataProvider("message", async () => "Hello world");

    const result = await promptBuilder.build(mockAgentContext);

    expect(result.system).toBe("Hello Alice, you have 5 messages");
    expect(result.user[0].text).toBe("User: Hello world");
});

test("PromptBuilder 应该正确处理数据提供者错误", async () => {
    const config = {
        SystemTemplate: "Template with {{errorData}}",
        UserTemplate: "User template",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    // 注册会抛出错误的数据提供者
    promptBuilder.registerDataProvider("errorData", async () => {
        throw new Error("数据获取失败");
    });

    const result = await promptBuilder.build(mockAgentContext);

    // 应该包含错误占位符
    expect(result.system).toContain("[Error rendering errorData]");
});

test("PromptBuilder 应该正确处理 partials", async () => {
    const config = {
        SystemTemplate: "Main template {{>header}} content {{>footer}}",
        UserTemplate: "User content",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    // 注册 partials
    promptBuilder.registerPartial("header", "Header: {{title}}");
    promptBuilder.registerPartial("footer", "Footer: {{year}}");

    // 注册数据提供者
    promptBuilder.registerDataProvider("title", async () => "测试标题");
    promptBuilder.registerDataProvider("year", async () => "2024");

    const result = await promptBuilder.build(mockAgentContext);

    expect(result.system).toContain("Header: 测试标题");
    expect(result.system).toContain("Footer: 2024");
});

test("PromptBuilder 应该正确缓存数据提供者结果", async () => {
    const config = {
        SystemTemplate: "{{data}} {{data}}", // 使用相同数据两次
        UserTemplate: "User template",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    const dataProviderMock = mock(() => Promise.resolve("cached-data"));
    promptBuilder.registerDataProvider("data", dataProviderMock);

    await promptBuilder.build(mockAgentContext);

    // 数据提供者应该只被调用一次（由于缓存）
    expect(dataProviderMock).toHaveBeenCalledTimes(1);
});

test("PromptBuilder 应该正确处理嵌套对象数据", async () => {
    const config = {
        SystemTemplate: "User: {{user.name}} ({{user.id}})",
        UserTemplate: "Message: {{message.content}}",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    promptBuilder.registerDataProvider("user", async () => ({
        name: "Alice",
        id: "user-123",
    }));

    promptBuilder.registerDataProvider("message", async () => ({
        content: "Hello world",
        timestamp: "2024-01-01",
    }));

    const result = await promptBuilder.build(mockAgentContext);

    expect(result.system).toBe("User: Alice (user-123)");
    expect(result.user[0].text).toBe("Message: Hello world");
});

test("PromptBuilder 应该正确处理空数据", async () => {
    const config = {
        SystemTemplate: "Data: {{emptyData}}",
        UserTemplate: "User template",
    };

    const promptBuilder = new PromptBuilder(mockContext, config);

    promptBuilder.registerDataProvider("emptyData", async () => null);

    const result = await promptBuilder.build(mockAgentContext);

    expect(result.system).toBe("Data: ");
});

beforeEach(() => {
    // 重置所有 mock
    mock.restore();
});
