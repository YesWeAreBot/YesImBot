/** 只统计流式协议和用量，不保存提示词、正文或请求凭据。 */
export class StreamDiagnostics {
    private readonly decoder = new TextDecoder();
    private line = "";
    private oversizedLine = false;
    private bytes = 0;
    private firstChunkMs?: number;
    private headersMs?: number;
    private httpStatus?: number;
    private contentType?: string;
    private frames = 0;
    private contentChars = 0;
    private reasoningChars = 0;
    private toolFrames = 0;
    private errorFrames = 0;
    private malformedFrames = 0;
    private done = false;
    private eof = false;
    private usage?: unknown;
    private finishReason?: string;

    constructor(private readonly startedAt: number) {}

    recordResponse(response: Response): void {
        this.headersMs = Date.now() - this.startedAt;
        this.httpStatus = response.status;
        this.contentType = response.headers.get("content-type") ?? undefined;
    }

    observe(response: Response): Response {
        if (!response.body) return response;
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform: (chunk, controller) => {
                this.firstChunkMs ??= Date.now() - this.startedAt;
                this.bytes += chunk.byteLength;
                this.scan(this.decoder.decode(chunk, { stream: true }));
                controller.enqueue(chunk);
            },
            flush: () => {
                this.scan(this.decoder.decode());
                this.eof = true;
            },
        }));
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    private scan(text: string): void {
        // 限制单行缓冲，异常的大帧不应让诊断额外占用无限内存。
        for (const part of text.split(/(?<=\n)/)) {
            if (!this.oversizedLine) {
                if (this.line.length + part.length <= 65536) this.line += part;
                else { this.line = ""; this.oversizedLine = true; }
            }
            if (part.endsWith("\n")) {
                if (!this.oversizedLine) this.recordLine(this.line.trimEnd());
                this.line = "";
                this.oversizedLine = false;
            }
        }
    }

    private recordLine(line: string): void {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        this.frames++;
        if (data === "[DONE]") { this.done = true; return; }
        try {
            const frame = JSON.parse(data);
            if (frame?.error) this.errorFrames++;
            if (frame?.usage) {
                // 只复制标准数字字段，上游扩展字段不进入日志。
                this.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"]
                    .filter(key => typeof frame.usage[key] === "number")
                    .map(key => [key, frame.usage[key]]));
            }
            const choice = frame?.choices?.[0];
            const delta = choice?.delta;
            if (typeof delta?.content === "string") this.contentChars += delta.content.length;
            if (typeof delta?.reasoning_content === "string") this.reasoningChars += delta.reasoning_content.length;
            if (delta?.tool_calls?.length) this.toolFrames++;
            if (delta?.refusal) this.errorFrames++;
            if (typeof choice?.finish_reason === "string") this.finishReason = choice.finish_reason.slice(0, 64);
        } catch {
            this.malformedFrames++;
        }
    }

    summary(): Record<string, unknown> {
        return {
            httpStatus: this.httpStatus, contentType: this.contentType,
            elapsedMs: Date.now() - this.startedAt, headersMs: this.headersMs, firstChunkMs: this.firstChunkMs,
            bytes: this.bytes, frames: this.frames, contentChars: this.contentChars, reasoningChars: this.reasoningChars,
            toolFrames: this.toolFrames, errorFrames: this.errorFrames, malformedFrames: this.malformedFrames,
            usage: this.usage, finishReason: this.finishReason, done: this.done, eof: this.eof,
            pendingLineChars: this.line.length, oversizedLine: this.oversizedLine,
        };
    }

    hasUnterminatedData(): boolean {
        return this.eof && this.line.startsWith("data:") && this.line.slice(5).trim() !== "[DONE]";
    }
}
