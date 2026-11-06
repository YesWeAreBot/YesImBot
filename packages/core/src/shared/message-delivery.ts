import { h } from "koishi";

// Internal encoder option: scoped to one send, never shared across concurrent calls.
export const messageReceiptSink = Symbol("message receipt sink");

export type ConfirmedMessage = { id: string; content?: string; elements?: h[] };

export function confirmedMessages(messages: ConfirmedMessage[]): ConfirmedMessage[] {
    return messages
        .filter((message) => typeof message?.id === "string" && message.id.trim().length > 0)
        .map((message) => {
            const content =
                typeof message.content === "string"
                    ? message.content
                    : Array.isArray(message.elements)
                      ? message.elements.map((element) => h(element.type, element.attrs, element.children).toString()).join("")
                      : undefined;
            return { id: message.id, ...(content !== undefined ? { content } : {}) };
        });
}

/** A failed send may still have delivered messages confirmed by its encoder. */
export class MessageDeliveryError extends Error {
    readonly messages: ConfirmedMessage[];

    constructor(cause: unknown, messages: ConfirmedMessage[]) {
        super(cause instanceof Error ? cause.message : "消息发送失败", { cause });
        this.name = "MessageDeliveryError";
        this.messages = confirmedMessages(messages);
    }
}
