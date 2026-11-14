import { AsyncLocalStorage } from "node:async_hooks";

import { isConversationReportEnabled, recordConversationReport } from "../logger/conversation-report";

type ModelRequest = {
    requestId: string;
    provider?: string;
    model: string;
    purpose?: string;
};
type WireRequest = {
    source: ModelRequest;
    index: number;
    body?: BodyInit | null;
    reachedTransport: boolean;
};
type ModelCapture = {
    source: ModelRequest;
    requests: number;
    incompleteResponses: Set<() => void>;
};

const maxBodyBytes = 2 * 1024 * 1024;
const model = new AsyncLocalStorage<ModelCapture>();
const wire = new AsyncLocalStorage<WireRequest>();
let sequence = 0;

export function modelReportRequestId(purpose: "evaluation" | "embedding"): string {
    return `${purpose}-${++sequence}`;
}

export function withModelConversationReport<T>(source: ModelRequest, run: () => Promise<T>): Promise<T> {
    if (!isConversationReportEnabled()) return run();
    const scope: ModelCapture = { source, requests: 0, incompleteResponses: new Set() };
    return model.run(scope, async () => {
        try {
            return await run();
        } finally {
            // Some SDK error and early-stop paths do not drain or cancel a response.
            // Snapshot what was consumed before the caller can publish its report.
            for (const snapshot of scope.incompleteResponses) snapshot();
        }
    });
}

function requestData(body: BodyInit | null | undefined): { payload?: unknown; omitted?: string; bytes?: number } {
    if (typeof body !== "string") return { omitted: body ? "unsupported_request_body" : "no_request_body" };
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > maxBodyBytes) {
        // Keep prompts and tool schemas when inline media alone exceeds the budget.
        try {
            const shortened = JSON.stringify(JSON.parse(body), (key, value) =>
                typeof value === "string" && (value.startsWith("data:") || (key === "data" && value.length > 4096 && /^[A-Za-z0-9+/=]+$/.test(value)))
                    ? "[inline media omitted]"
                    : value,
            );
            if (Buffer.byteLength(shortened, "utf8") <= maxBodyBytes && shortened !== body)
                return { omitted: "inline_media_omitted", payload: JSON.parse(shortened), bytes };
        } catch {
            /* The oversized request body stays out of the report. */
        }
        return { omitted: "request_body_limit", bytes };
    }
    try {
        return { payload: JSON.parse(body) };
    } catch {
        return { payload: body };
    }
}

function captureResponse(response: Response, capture: ModelCapture, request: WireRequest, signal?: AbortSignal | null): Response {
    const { status, statusText, headers, body } = response;
    const metadata = { ...request.source, wireRequest: request.index, status, contentType: headers.get("content-type") };
    if (!body) {
        recordConversationReport("model.response", { ...metadata, outcome: "no_body" });
        return response;
    }

    const recordInConversation = AsyncLocalStorage.snapshot();
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let receivedBytes = 0;
    let completed = false;

    const finish = (outcome: string) => {
        if (completed) return;
        completed = true;
        signal?.removeEventListener("abort", onAbort);
        capture.incompleteResponses.delete(snapshot);
        parts.push(decoder.decode());
        recordInConversation(() =>
            recordConversationReport("model.response", {
                ...metadata,
                outcome,
                receivedBytes,
                truncated: receivedBytes > maxBodyBytes,
                raw: parts.join(""),
            }),
        );
        parts.length = 0;
    };
    const snapshot = () => finish(signal?.aborted ? "aborted" : "not_fully_read");
    const onAbort = () => finish("aborted");
    capture.incompleteResponses.add(snapshot);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const observed = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        finish("complete");
                        controller.close();
                        return;
                    }
                    if (!completed) {
                        const remaining = maxBodyBytes - receivedBytes;
                        if (remaining > 0) parts.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
                        receivedBytes += value.byteLength;
                    }
                    controller.enqueue(value);
                } catch (error) {
                    finish("read_error");
                    controller.error(error);
                }
            },
            async cancel(reason) {
                finish(signal?.aborted ? "aborted" : "cancelled");
                await reader.cancel(reason);
            },
        },
        { highWaterMark: 0 },
    );
    const wrapped = new Response(observed, { status, statusText, headers });
    for (const key of ["redirected", "type", "url"] as const) Object.defineProperty(wrapped, key, { value: response[key] });
    return wrapped;
}

/** Final framework payload, including the exact messages and tools seen by the provider adapter. */
export function observeModelReportRequest(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
        const capture = model.getStore();
        if (!capture) return fetch(input, init);
        const request = { source: capture.source, index: ++capture.requests, body: init?.body, reachedTransport: false };
        recordConversationReport("model.request", { ...capture.source, wireRequest: request.index, ...requestData(request.body) });
        return wire.run(request, async () => {
            try {
                const response = await fetch(input, init);
                return request.reachedTransport ? response : captureResponse(response, capture, request, init?.signal);
            } catch (error) {
                recordConversationReport("model.request_failed", {
                    ...capture.source,
                    wireRequest: request.index,
                    errorType: error instanceof Error ? error.name : typeof error,
                    aborted: init?.signal?.aborted ?? false,
                });
                throw error;
            }
        });
    };
}

/** Capture the provider bytes before any native adapter converts JSON or SSE. */
export function observeModelReportTransport(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
        const capture = model.getStore();
        const request = wire.getStore();
        if (!capture || !request) return fetch(input, init);
        request.reachedTransport = true;
        if (init?.body !== request.body)
            recordConversationReport("model.provider_request", { ...request.source, wireRequest: request.index, ...requestData(init?.body) });
        return captureResponse(await fetch(input, init), capture, request, init?.signal);
    };
}
