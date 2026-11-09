import { choice, completed, inlineImage, Json, partsOf, rejectUnknown, safeToolArguments, toolData, toolId } from "./shared";

function anthropicParts(content: unknown): Json[] {
    return partsOf(content).map((part) => {
        if (part.type === "text") return { type: "text", text: part.text, ...(part.cache_control ? { cache_control: part.cache_control } : {}) };
        if (part.type === "image_url") {
            const url = part.image_url?.url;
            const inline = typeof url === "string" ? inlineImage(url) : undefined;
            if (inline) return { type: "image", source: { type: "base64", media_type: inline.mimeType, data: inline.data } };
            if (typeof url === "string" && /^https?:\/\//.test(url)) return { type: "image", source: { type: "url", url } };
            throw new Error("Anthropic 图片需要 HTTP URL 或 base64 data URL");
        }
        throw new Error(`Anthropic 原生接入不支持消息内容 ${part.type}`);
    });
}
export function anthropicRequest(body: Json): Json {
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
        "thinking",
        "output_config",
        "metadata",
        "n",
        "cache_control",
        "service_tier",
    ]);
    if (body.temperature !== undefined && body.top_p !== undefined) throw new Error("Anthropic 原生接入不能同时设置 temperature 和 top_p");
    if (body.n !== undefined && body.n !== 1) throw new Error("Anthropic 原生接入仅支持 n=1");
    const system: Json[] = [];
    const messages: Json[] = [];
    for (const message of body.messages ?? []) {
        if (message.role === "system" || message.role === "developer") {
            system.push(...anthropicParts(message.content));
            continue;
        }
        let content: Json[];
        let role: string;
        if (message.role === "tool") {
            role = "user";
            content = [
                {
                    type: "tool_result",
                    tool_use_id: toolData(message.tool_call_id, "anthropic-native").id,
                    content: Array.isArray(message.content) ? anthropicParts(message.content) : (message.content ?? ""),
                },
            ];
        } else {
            if (!["user", "assistant"].includes(message.role)) throw new Error(`Anthropic 不支持消息角色 ${message.role}`);
            role = message.role;
            content = anthropicParts(message.content);
            if (message.tool_calls?.length) {
                const meta = toolData(message.tool_calls[0].id, "anthropic-native");
                if (meta.parts.length) content = meta.parts;
                else
                    content.push(
                        ...message.tool_calls.map((call: Json) => ({
                            type: "tool_use",
                            id: toolData(call.id, "anthropic-native").id,
                            name: call.function.name,
                            input: safeToolArguments(call.function.arguments),
                        })),
                    );
            }
        }
        // Adjacent user tool results form a single native user turn.
        if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...content);
        else messages.push({ role, content });
    }
    const result: Json = { model: body.model, messages, max_tokens: body.max_completion_tokens ?? body.max_tokens ?? 4096, stream: !!body.stream };
    if (system.length) result.system = system;
    for (const key of ["temperature", "top_p", "top_k", "thinking", "output_config", "metadata", "cache_control", "service_tier"])
        if (body[key] !== undefined) result[key] = body[key];
    if (body.stop) result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (body.tools?.length)
        result.tools = body.tools.map((tool: Json) => {
            if (tool.type !== "function" || !tool.function?.name) throw new Error("Anthropic 原生接入仅支持函数工具");
            return {
                name: tool.function.name,
                description: tool.function.description,
                input_schema: tool.function.parameters,
                ...(tool.function.strict !== undefined ? { strict: tool.function.strict } : {}),
            };
        });
    if (body.tool_choice !== undefined) {
        const choice = body.tool_choice;
        const type = choice === "required" ? "any" : choice === "auto" ? "auto" : choice === "none" ? "none" : choice?.type === "function" ? "tool" : null;
        if (!type) throw new Error("Anthropic 不支持此 tool_choice");
        result.tool_choice = { type, ...(type === "tool" ? { name: choice.function.name } : {}) };
    }
    return result;
}
export function anthropicUsage(value: Json = {}): Json {
    const input =
        value.input_tokens !== undefined ? value.input_tokens + (value.cache_read_input_tokens ?? 0) + (value.cache_creation_input_tokens ?? 0) : undefined;
    return {
        prompt_tokens: input,
        completion_tokens: value.output_tokens,
        total_tokens: input !== undefined && value.output_tokens !== undefined ? input + value.output_tokens : undefined,
        prompt_tokens_details: { cached_tokens: value.cache_read_input_tokens, cache_write_tokens: value.cache_creation_input_tokens },
    };
}
function finishReason(reason: string, toolBearing = false): string {
    if (toolBearing && reason !== "tool_use") throw new Error(`Anthropic 工具调用未正常完成，禁止执行: ${reason ?? "缺少结束原因"}`);
    if (!["end_turn", "stop_sequence", "tool_use", "max_tokens", "refusal", "model_context_window_exceeded"].includes(reason))
        throw new Error(`Anthropic 原生回复异常结束: ${reason}`);
    if (reason === "model_context_window_exceeded") return "length";
    return reason === "tool_use" ? "tool_calls" : reason === "max_tokens" ? "length" : reason === "refusal" ? "content_filter" : "stop";
}
function toolCalls(parts: Json[]): Json[] {
    for (const part of parts)
        if (!part || !["text", "tool_use", "thinking", "redacted_thinking"].includes(part.type)) throw new Error("Anthropic 原生回复包含不支持的内容类型");
    return parts
        .filter((part) => part.type === "tool_use")
        .map((part) => ({
            id: toolId("anthropic-native", part.id, parts),
            type: "function",
            function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
        }));
}
export function anthropicResponse(value: Json): Json {
    if (!Array.isArray(value.content)) throw new Error("Anthropic 未返回有效回复内容");
    const calls = toolCalls(value.content);
    return completed(
        {
            content: value.content
                .filter((part: Json) => part.type === "text")
                .map((part: Json) => part.text)
                .join(""),
            ...(calls.length ? { tool_calls: calls } : {}),
        },
        finishReason(value.stop_reason, calls.length > 0),
        anthropicUsage(value.usage),
        value.id,
    );
}
export function anthropicStream() {
    const blocks: Json[] = [];
    const argumentsText = new Map<number, string>();
    let usage: Json = {};
    let reason = "";
    let finished = false;
    return {
        consume(value: Json): Json[] {
            if (value.type === "message_start") {
                usage = { ...usage, ...value.message?.usage };
                return [];
            }
            if (value.type === "content_block_start") {
                blocks[value.index] = { ...value.content_block };
                if (value.content_block.type === "tool_use") {
                    argumentsText.set(value.index, "");
                    return [choice({ yib_native_activity: true })];
                }
                return value.content_block.type === "text" && value.content_block.text ? [choice({ content: value.content_block.text })] : [];
            }
            if (value.type === "content_block_delta") {
                const block = blocks[value.index];
                if (!block) throw new Error("Anthropic 流内容块缺少起始事件");
                const delta = value.delta;
                if (delta.type === "text_delta") {
                    block.text = (block.text ?? "") + delta.text;
                    return [choice({ content: delta.text })];
                }
                if (delta.type === "input_json_delta") argumentsText.set(value.index, (argumentsText.get(value.index) ?? "") + delta.partial_json);
                else if (delta.type === "thinking_delta") block.thinking = (block.thinking ?? "") + delta.thinking;
                else if (delta.type === "signature_delta") block.signature = (block.signature ?? "") + delta.signature;
                else if (delta.type !== "citations_delta") throw new Error(`Anthropic 原生流不支持增量类型 ${delta.type}`);
                return [];
            }
            if (value.type === "content_block_stop") {
                const block = blocks[value.index];
                if (block?.type === "tool_use") {
                    const text = argumentsText.get(value.index);
                    if (text) block.input = safeToolArguments(text);
                }
            }
            if (value.type === "message_delta") {
                usage = { ...usage, ...value.usage };
                reason = value.delta?.stop_reason ?? reason;
            }
            if (value.type === "message_stop") finished = true;
            return [];
        },
        finish(): Json[] {
            if (!finished || !reason) throw new Error("Anthropic 流已截断，未收到完整结束事件");
            const calls = toolCalls(blocks);
            return [
                ...calls.map((call, index) => choice({ tool_calls: [{ index, ...call }] })),
                { ...choice({}, finishReason(reason, calls.length > 0)), usage: anthropicUsage(usage) },
            ];
        },
    };
}
