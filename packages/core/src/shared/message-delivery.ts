export type ConfirmedMessage = { id: string; content?: string };

/** A failed send may still have delivered messages confirmed by its encoder. */
export class MessageDeliveryError extends Error {
    readonly messages: ConfirmedMessage[];

    constructor(cause: unknown, messages: ConfirmedMessage[]) {
        super(cause instanceof Error ? cause.message : "消息发送失败", { cause });
        this.name = "MessageDeliveryError";
        this.messages = messages
            .filter((message) => typeof message?.id === "string" && message.id.trim().length > 0)
            .map((message) => ({ id: message.id, ...(typeof message.content === "string" ? { content: message.content } : {}) }));
    }
}
