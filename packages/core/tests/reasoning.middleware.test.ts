///<reference types="bun-types" />

import { expect, test, mock, beforeEach, afterEach } from "bun:test";
import { Context } from "koishi";
import { ReasoningMiddleware } from "../src/middleware/reasoning.middleware";
import { MiddlewareContext } from "../src/middleware";

// Mock services
const mockDataManager = {
    addAgentResponse: mock(() => Promise.resolve())
};

const mockModelService = {
    getChatModelSwitcher: mock(() => ({
        getCurrent: mock(() => ({
            chat: mock(() => Promise.resolve({
                text: JSON.stringify({
                    thoughts: {
                        observe: "测试观察",
                        analyze_infer: "测试分析",
                        plan: "测试计划"
                    },
                    actions: [
                        {
                            function: "test_tool",
                            params: { message: "测试参数" }
                        }
                    ],
                    request_heartbeat: false
                })
            }))
        }))
    }))
};

const mockPromptBuilder = {
    build: mock(() => Promise.resolve({
        system: "测试系统提示词",
        user: "测试用户提示词"
    }))
};

const mockToolService = {
    getTool: mock((name: string) => ({
        execute: mock(() => Promise.resolve({
            status: "success",
            result: "测试工具执行结果"
        }))
    }))
};

const mockContext = {
    logger: (name: string) => ({
        info: mock(),
        warn: mock(),
        error: mock(),
        debug: mock()
    }),
    "yesimbot.data": mockDataManager,
    "yesimbot.model": mockModelService,
    "yesimbot.promptBuilder": mockPromptBuilder,
    "yesimbot.tool": mockToolService
} as any;

const mockMiddlewareContext = {
    koishiContext: mockContext,
    koishiSession: {
        messageId: "test-message-id",
        userId: "test-user-id",
        channelId: "test-channel-id",
        content: "测试消息内容"
    },
    _platform: {
        sendMessage: mock(() => Promise.resolve())
    },
    currentTurnId: "test-turn-id",
    agentResponses: [],
    shared: new Map()
} as any;

test("ReasoningMiddleware 应该正确初始化", () => {
    const config = {
        maxRetry: 3,
        life: 3,
        maxHeartbeat: 5,
        timeoutMs: 30000,
        retryDelayMs: 1500,
        enableDebug: false
    };

    const middleware = new ReasoningMiddleware(mockContext, config);

    expect(middleware).toBeDefined();
    expect(middleware.name).toBe("reasoning");
});

test("ReasoningMiddleware 应该正确执行推理循环", async () => {
    const config = {
        maxRetry: 3,
        life: 3,
        maxHeartbeat: 5,
        timeoutMs: 30000,
        retryDelayMs: 1500,
        enableDebug: false
    };

    const middleware = new ReasoningMiddleware(mockContext, config);
    const nextMock = mock(() => Promise.resolve());

    await middleware.execute(mockMiddlewareContext, nextMock);

    // 验证 PromptBuilder 被调用
    expect(mockPromptBuilder.build).toHaveBeenCalled();

    // 验证模型服务被调用
    expect(mockModelService.getChatModelSwitcher).toHaveBeenCalled();

    // 验证工具服务被调用
    expect(mockToolService.getTool).toHaveBeenCalledWith("test_tool");

    // 验证数据管理器被调用
    expect(mockDataManager.addAgentResponse).toHaveBeenCalled();

    // 验证 next() 被调用
    expect(nextMock).toHaveBeenCalled();

    // 验证 agentResponses 被填充
    expect(mockMiddlewareContext.agentResponses).toHaveLength(1);
});

test("ReasoningMiddleware 应该处理心跳请求", async () => {
    // 创建一个计数器来控制 mock 行为
    let callCount = 0;
    const mockModelWithHeartbeat = {
        getChatModelSwitcher: mock(() => ({
            getCurrent: mock(() => ({
                chat: mock(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.resolve({
                            text: JSON.stringify({
                                thoughts: {
                                    observe: "第一次观察",
                                    analyze_infer: "第一次分析",
                                    plan: "第一次计划"
                                },
                                actions: [],
                                request_heartbeat: true
                            })
                        });
                    } else {
                        return Promise.resolve({
                            text: JSON.stringify({
                                thoughts: {
                                    observe: "第二次观察",
                                    analyze_infer: "第二次分析",
                                    plan: "第二次计划"
                                },
                                actions: [],
                                request_heartbeat: false
                            })
                        });
                    }
                })
            }))
        }))
    };

    const contextWithHeartbeat = {
        ...mockContext,
        "yesimbot.model": mockModelWithHeartbeat
    };

    const config = {
        maxRetry: 3,
        life: 3,
        maxHeartbeat: 5,
        timeoutMs: 30000,
        retryDelayMs: 1500,
        enableDebug: false
    };

    const middleware = new ReasoningMiddleware(contextWithHeartbeat, config);
    const nextMock = mock(() => Promise.resolve());
    const testContext = { ...mockMiddlewareContext, agentResponses: [] };

    await middleware.execute(testContext, nextMock);

    // 验证执行了两次心跳
    expect(testContext.agentResponses).toHaveLength(2);
});

test("ReasoningMiddleware 应该处理工具执行失败", async () => {
    const mockToolServiceWithError = {
        getTool: mock(() => ({
            execute: mock(() => Promise.reject(new Error("工具执行失败")))
        }))
    };

    const contextWithError = {
        ...mockContext,
        "yesimbot.tool": mockToolServiceWithError
    };

    const config = {
        maxRetry: 3,
        life: 3,
        maxHeartbeat: 5,
        timeoutMs: 30000,
        retryDelayMs: 1500,
        enableDebug: false
    };

    const middleware = new ReasoningMiddleware(contextWithError, config);
    const nextMock = mock(() => Promise.resolve());
    const testContext = { ...mockMiddlewareContext, agentResponses: [] };

    await middleware.execute(testContext, nextMock);

    // 验证即使工具失败，中间件仍然完成执行
    expect(nextMock).toHaveBeenCalled();
    expect(testContext.agentResponses).toHaveLength(1);

    // 验证错误被正确记录
    const response = testContext.agentResponses[0];
    expect(response.observations[0].result.success).toBe(false);
    expect(response.observations[0].result.error).toBe("工具执行失败");
});

test("ReasoningMiddleware 应该处理 LLM 响应解析失败", async () => {
    const mockModelWithInvalidResponse = {
        getChatModelSwitcher: mock(() => ({
            getCurrent: mock(() => ({
                chat: mock(() => Promise.resolve({
                    text: "这不是有效的 JSON 响应"
                }))
            }))
        }))
    };

    const contextWithInvalidResponse = {
        ...mockContext,
        "yesimbot.model": mockModelWithInvalidResponse
    };

    const config = {
        maxRetry: 3,
        life: 3,
        maxHeartbeat: 5,
        timeoutMs: 30000,
        retryDelayMs: 1500,
        enableDebug: false
    };

    const middleware = new ReasoningMiddleware(contextWithInvalidResponse, config);
    const nextMock = mock(() => Promise.resolve());
    const testContext = { ...mockMiddlewareContext, agentResponses: [] };

    await middleware.execute(testContext, nextMock);

    // 验证即使解析失败，中间件仍然完成执行
    expect(nextMock).toHaveBeenCalled();

    // 验证没有生成 agentResponse（因为解析失败）
    expect(testContext.agentResponses).toHaveLength(0);
});

beforeEach(() => {
    // 重置所有 mock
    mock.restore();
});

afterEach(() => {
    // 清理
    mock.restore();
});
