import type { RequestInit as uRequestInit } from "undici";
import { ProxyAgent, fetch as ufetch } from "undici";

export type AnyFetch = typeof globalThis.fetch;

export interface RetryPolicy {
    retry: number;
    retryDelay?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRetry(fetchFn: AnyFetch, policy: RetryPolicy): AnyFetch {
    const retry = Math.max(0, policy.retry ?? 0);
    const retryDelay = Math.max(0, policy.retryDelay ?? 0);

    if (retry <= 0)
        return fetchFn;

    return (async (input: any, init?: any) => {
        let lastError: unknown;

        for (let attempt = 0; attempt <= retry; attempt++) {
            try {
                const resp: Response = await (fetchFn as any)(input, init);

                if (resp && !resp.ok && (resp.status === 429 || (resp.status >= 500 && resp.status <= 599))) {
                    if (attempt < retry) {
                        await sleep(retryDelay);
                        continue;
                    }
                }

                return resp;
            } catch (err) {
                lastError = err;
                if (attempt < retry) {
                    await sleep(retryDelay);
                    continue;
                }
                throw err;
            }
        }

        // Should be unreachable.
        throw lastError;
    }) as unknown as AnyFetch;
}

function wrapFetch(fetchFn: AnyFetch): AnyFetch {
    return function (url: any, options?: any): Promise<Response> {
        return (fetchFn as any)(url, options) as Promise<Response>;
    } as unknown as AnyFetch;
}

export function useProxy(proxy: string): AnyFetch {
    const agent = new ProxyAgent(proxy);
    const customFetch: AnyFetch = (url: any, options?: RequestInit): Promise<Response> => {
        const init: uRequestInit = (options as uRequestInit) || {};
        init.dispatcher = agent;
        return ufetch(url, init) as unknown as Promise<Response>;
    };
    return wrapFetch(customFetch);
}

export interface SharedFetchOptions {
    fetch?: AnyFetch;
    proxy?: string;
    retry?: number;
    retryDelay?: number;
}

export function createSharedFetch(options: SharedFetchOptions = {}): AnyFetch {
    const baseFetch: AnyFetch = options.fetch
        ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) as AnyFetch : (ufetch as unknown as AnyFetch));

    const proxied = (options.proxy && options.proxy.length > 0)
        ? useProxy(options.proxy)
        : baseFetch;

    const retry = options.retry ?? 0;
    if (retry && retry > 0) {
        return withRetry(proxied, { retry, retryDelay: options.retryDelay ?? 1000 });
    }

    return proxied;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object")
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function deepMerge<T>(base: T, ...overrides: Array<Partial<T> | undefined>): T {
    let result: any = base;

    for (const override of overrides) {
        if (!override)
            continue;

        if (!isPlainObject(result) || !isPlainObject(override)) {
            result = override as any;
            continue;
        }

        const next: Record<string, unknown> = { ...result };
        for (const [key, value] of Object.entries(override)) {
            const current = (next as any)[key];

            if (isPlainObject(current) && isPlainObject(value)) {
                (next as any)[key] = deepMerge(current, value as any);
            } else {
                (next as any)[key] = value as any;
            }
        }

        result = next;
    }

    return result as T;
}
