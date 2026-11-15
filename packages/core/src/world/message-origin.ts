import { AsyncLocalStorage } from "node:async_hooks";

const outgoingOrigin = new AsyncLocalStorage<"model">();

export function withModelMessageOrigin<T>(send: () => T): T {
    return outgoingOrigin.run("model", send);
}

export function getModelMessageOrigin(): "model" | undefined {
    return outgoingOrigin.getStore();
}
