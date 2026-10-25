import { choice, completed, inlineImage, Json, partsOf, rejectUnknown, safeToolArguments, toolData, toolId } from "./shared";

function geminiParts(content: unknown): Json[] {
    return partsOf(content).map((part) => {
        if (part.type === "text") return { text: part.text };
        if (part.type === "image_url") {
            const url = part.image_url?.url;
            const inline = typeof url === "string" ? inlineImage(url) : undefined;
            if (inline) return { inlineData: inline };
            // Remote HTTP images require explicit upload/file API handling, not an implicit server-side fetch.
            throw new Error("Gemini 原生图片目前需要 base64 data URL");
        }
        throw new Error(`Gemini 原生接入不支持消息内容 ${part.type}`);
    });
}
function geminiToolResult(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content) || content.some((part) => part?.type !== "text" || typeof part.text !== "string"))
        throw new Error("Gemini 原生工具结果目前仅支持文本，不支持图片或音频");
    return content.map((part) => part.text).join("");
}
export function geminiRequest(body: Json): Json {
    rejectUnknown(body, [
        "model",
        "messages",
        "stream",
        "stream_options",
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "max_completion_tokens",
        "stop",
        "tools",
        "tool_choice",
        "response_format",
        "seed",
        "n",
        "generation_config",
        "safety_settings",
        "cached_content",
        "tool_config",
    ]);
    if (body.n !== undefined && body.n !== 1) throw new Error("Gemini 原生接入仅支持 n=1");
    const system: Json[] = [];
    const contents: Json[] = [];
    const calls = new Map<string, Json>();
    for (const message of body.messages ?? []) {
        if (message.role === "system" || message.role === "developer") {
            system.push(...geminiParts(message.content));
            continue;
        }
        if (message.role === "tool") {
            const call = calls.get(message.tool_call_id);
            if (!call) throw new Error("Gemini 工具结果缺少对应调用");
            const metadata = toolData(message.tool_call_id, "gemini-native");
            const functionResponse = {
                name: call.function.name,
                ...(metadata.id ? { id: metadata.id } : {}),
                response: { result: geminiToolResult(message.content) },
            };
            const last = contents.at(-1);
            if (last?.role === "user") last.parts.push({ functionResponse });
            else contents.push({ role: "user", parts: [{ functionResponse }] });
            continue;
        }
        if (!["user", "assistant"].includes(message.role)) throw new Error(`Gemini 不支持消息角色 ${message.role}`);
        let parts = geminiParts(message.content);
        if (message.tool_calls?.length) {
            const meta = toolData(message.tool_calls[0].id, "gemini-native");
            if (meta.parts.length) parts = meta.parts;
            else
                for (const call of message.tool_calls) {
                    const nativeId = toolData(call.id, "gemini-native").id;
                    parts.push({
                        functionCall: { name: call.function.name, args: safeToolArguments(call.function.arguments), ...(nativeId ? { id: nativeId } : {}) },
                    });
                }
            for (const call of message.tool_calls) calls.set(call.id, call);
        }
        contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
    }
    const generationConfig: Json = { ...body.generation_config };
    const fields = { temperature: "temperature", top_p: "topP", top_k: "topK", seed: "seed" };
    for (const [key, target] of Object.entries(fields)) if (body[key] !== undefined) generationConfig[target] = body[key];
    if (body.max_completion_tokens !== undefined || body.max_tokens !== undefined)
        generationConfig.maxOutputTokens = body.max_completion_tokens ?? body.max_tokens;
    if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (body.response_format?.type === "json_object") generationConfig.responseMimeType = "application/json";
    else if (body.response_format?.type === "json_schema") {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseJsonSchema = body.response_format.json_schema?.schema;
    } else if (body.response_format && body.response_format.type !== "text") throw new Error("Gemini 不支持此 response_format");
    const request: Json = { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}), generationConfig };
    if (body.tools?.length)
        request.tools = [
            {
                functionDeclarations: body.tools.map((tool: Json) => {
                    if (tool.type !== "function" || !tool.function?.name) throw new Error("Gemini 原生接入仅支持函数工具");
                    if (tool.function.strict) throw new Error("Gemini 原生函数工具不支持 strict；请使用参数校验或兼容协议");
                    return { name: tool.function.name, description: tool.function.description, parametersJsonSchema: tool.function.parameters };
                }),
            },
        ];
    if (body.tool_choice !== undefined) {
        const choice = body.tool_choice;
        const mode = choice === "none" ? "NONE" : choice === "required" ? "ANY" : choice === "auto" ? "AUTO" : choice?.type === "function" ? "ANY" : null;
        if (!mode) throw new Error("Gemini 不支持此 tool_choice");
        request.toolConfig = { functionCallingConfig: { mode, ...(choice?.function?.name ? { allowedFunctionNames: [choice.function.name] } : {}) } };
    }
    if (body.tool_config) request.toolConfig = body.tool_config;
    if (body.safety_settings) request.safetySettings = body.safety_settings;
    if (body.cached_content) request.cachedContent = body.cached_content;
    return request;
}
export function geminiUsage(value: Json = {}): Json {
    return {
        prompt_tokens: value.promptTokenCount,
        completion_tokens:
            value.candidatesTokenCount !== undefined || value.thoughtsTokenCount !== undefined
                ? (value.candidatesTokenCount ?? 0) + (value.thoughtsTokenCount ?? 0)
                : undefined,
        total_tokens: value.totalTokenCount,
        prompt_tokens_details: { cached_tokens: value.cachedContentTokenCount },
        completion_tokens_details: { reasoning_tokens: value.thoughtsTokenCount },
    };
}
function finishReason(reason: string | undefined, calls: boolean): string {
    if (calls && reason !== "STOP") throw new Error(`Gemini 工具调用未正常完成，禁止执行: ${reason ?? "缺少结束原因"}`);
    if (reason && !["STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(reason))
        throw new Error(`Gemini 原生回复异常结束: ${reason}`);
    if (calls) return "tool_calls";
    if (reason === "MAX_TOKENS") return "length";
    if (reason === "STOP") return "stop";
    if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(reason ?? "")) return "content_filter";
    return "stop";
}
function toolCalls(parts: Json[]): Json[] {
    return parts
        .filter((part) => part.functionCall)
        .map((part) => ({
            id: toolId("gemini-native", part.functionCall.id, parts),
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
        }));
}
function validateParts(parts: Json[]) {
    for (const part of parts)
        if (!part || (!Object.hasOwn(part, "text") && !part.functionCall && !part.thoughtSignature)) throw new Error("Gemini 原生回复包含不支持的内容类型");
}
export function geminiResponse(value: Json): Json {
    if (value.error) throw new Error(value.error.message ?? "Gemini 返回错误");
    const candidate = value.candidates?.[0];
    if (!candidate) throw new Error(`Gemini 未返回候选回复${value.promptFeedback?.blockReason ? `: ${value.promptFeedback.blockReason}` : ""}`);
    const parts = candidate.content?.parts ?? [];
    validateParts(parts);
    const calls = toolCalls(parts);
    return completed(
        {
            content: parts
                .filter((part: Json) => part.text && !part.thought)
                .map((part: Json) => part.text)
                .join(""),
            ...(calls.length ? { tool_calls: calls } : {}),
        },
        finishReason(candidate.finishReason, calls.length > 0),
        geminiUsage(value.usageMetadata),
        value.responseId,
    );
}
export function geminiStream() {
    let finished = false;
    let usage: Json = {};
    const parts: Json[] = [];
    let reason: string | undefined;
    return {
        consume(value: Json): Json[] {
            const out: Json[] = [];
            if (value.usageMetadata) usage = { ...usage, ...value.usageMetadata };
            const candidate = value.candidates?.[0];
            if (value.promptFeedback?.blockReason && !candidate) throw new Error(`Gemini 回复被阻止: ${value.promptFeedback.blockReason}`);
            for (const part of candidate?.content?.parts ?? []) {
                parts.push(part);
                if (part.functionCall?.name) out.push(choice({ yib_native_activity: true }));
                if (part.text && !part.thought) out.push(choice({ content: part.text }));
            }
            if (candidate?.finishReason) {
                finished = true;
                reason = candidate.finishReason;
            }
            return out;
        },
        finish(): Json[] {
            if (!finished) throw new Error("Gemini 流已截断，未收到结束原因");
            validateParts(parts);
            const calls = toolCalls(parts);
            return [
                ...calls.map((call, index) => choice({ tool_calls: [{ index, ...call }] })),
                { ...choice({}, finishReason(reason, calls.length > 0)), usage: geminiUsage(usage) },
            ];
        },
    };
}
export function geminiEmbeddings(body: Json): Json {
    rejectUnknown(body, ["model", "input", "dimensions", "encoding_format", "task_type", "title"]);
    if (body.encoding_format && body.encoding_format !== "float") throw new Error("Gemini 原生嵌入仅支持 float 格式");
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    if (!inputs.length || inputs.some((input) => typeof input !== "string")) throw new Error("Gemini 原生嵌入需要字符串或非空字符串数组");
    return {
        requests: inputs.map((input) => ({
            model: `models/${String(body.model).replace(/^models\//, "")}`,
            content: { parts: [{ text: input }] },
            ...(body.dimensions !== undefined ? { outputDimensionality: body.dimensions } : {}),
            ...(body.task_type ? { taskType: body.task_type } : {}),
            ...(body.title ? { title: body.title } : {}),
        })),
    };
}
