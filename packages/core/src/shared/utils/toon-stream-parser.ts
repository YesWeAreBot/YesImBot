import { ToonParser } from "./toon-parser";

export interface ToonStreamState {
    status: "pending" | "streaming" | "completed";
    controller: ReadableStreamDefaultController<any>;
}

/**
 * Toon 格式流式解析器
 */
export class ToonStreamParser {
    private buffer = "";
    private lastProcessedIndex = 0;
    private currentAction: any = null;
    private inActionsList = false;
    private inParams = false;
    private thoughtsEmitted = false;

    private streamStates: Map<string, ToonStreamState> = new Map();
    private parser = new ToonParser();

    /**
     * 为指定的顶层键创建一个可读流
     * @param key 目前支持 "thoughts" 和 "actions"
     */
    public stream<T = any>(key: string): ReadableStream<T> {
        if (this.streamStates.has(key)) {
            throw new Error(`A stream for key "${key}" has already been created.`);
        }

        return new ReadableStream<T>({
            start: (controller) => {
                this.streamStates.set(key, {
                    controller,
                    status: "pending",
                });
            },
        });
    }

    public processText(text: string, final: boolean): void {
        this.buffer = text;
        this.processLines(final);

        if (final) {
            this.finalize();
        }
    }

    private processLines(final: boolean): void {
        // 简单处理：按行分割
        const lines = this.buffer.split("\n");
        // 如果不是最后一次，最后一行可能是不完整的，保留到下次处理
        const linesToProcess = final ? lines.length : lines.length - 1;

        for (let i = this.lastProcessedIndex; i < linesToProcess; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 处理 thoughts
            if (trimmed.startsWith("+ thoughts:")) {
                const thoughtsValue = trimmed.substring(11).trim();
                const state = this.streamStates.get("thoughts");
                if (state && !this.thoughtsEmitted) {
                    state.status = "streaming";
                    state.controller.enqueue(thoughtsValue);
                    this.thoughtsEmitted = true;
                }
                continue;
            }

            // 处理 actions 开始
            if (trimmed.startsWith("+ actions:")) {
                this.inActionsList = true;
                const state = this.streamStates.get("actions");
                if (state) state.status = "streaming";
                continue;
            }

            // 处理具体的 action
            if (trimmed.startsWith("- name:")) {
                // 如果之前有一个正在处理的 action，说明它已经结束了（因为 Toon 是平铺的）
                this.emitCurrentAction();

                const actionName = trimmed.substring(7).trim();
                this.currentAction = { name: actionName, params: {} };
                this.inParams = false;
                continue;
            }

            // 处理 params 标记
            if (trimmed.startsWith("params:")) {
                this.inParams = true;
                continue;
            }

            // 在 params 块内解析键值对
            if (this.inParams && this.currentAction) {
                const colonIndex = trimmed.indexOf(":");
                if (colonIndex !== -1) {
                    const key = trimmed.substring(0, colonIndex).trim();
                    const value = trimmed.substring(colonIndex + 1).trim();
                    this.currentAction.params[key] = value;
                }
            }
        }
        this.lastProcessedIndex = linesToProcess;
    }

    private emitCurrentAction(): void {
        if (this.currentAction) {
            const state = this.streamStates.get("actions");
            if (state) {
                state.controller.enqueue(this.currentAction);
            }
            this.currentAction = null;
        }
    }

    private finalize(): void {
        // 发出最后一个 action
        this.emitCurrentAction();

        // 如果 thoughts 还没发出（比如在最后一行且没有换行），尝试解析出完整数据
        if (!this.thoughtsEmitted) {
             const result = this.parser.parse(this.buffer);
             if (result.data && (result.data as any).thoughts) {
                 const state = this.streamStates.get("thoughts");
                 if (state) {
                     state.controller.enqueue((result.data as any).thoughts);
                     this.thoughtsEmitted = true;
                 }
             }
        }

        // 关闭所有流
        for (const state of this.streamStates.values()) {
            if (state.status !== "completed") {
                try {
                    state.controller.close();
                } catch (e) {}
                state.status = "completed";
            }
        }
    }
}
