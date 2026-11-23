import type { Context } from "koishi";

// Search adapters and result handling adapted from YesWeAreBot/ishiki.
// See resources/licenses/ishiki-search.txt for the original MIT notice.
import { createEngines } from "./engines/index";
import type { EngineConfig, EngineSearchResult, FetchOutput, SearchAttempt, SearchConfig, SearchEngine, SearchOutput } from "./types";
import { capAnswers, compileBlacklist, describeEngineFailure, isBlocked, mergeHits, normalizeUrl, timeoutSignal, truncate, validatedUrl } from "./utils";

export class SearchDispatchError extends Error {
    constructor(
        public readonly attempts: SearchAttempt[],
        public readonly retryable: boolean,
    ) {
        super("已选引擎均无法完成搜索");
    }
}

export class SearchService {
    private readonly engines: SearchEngine[];
    private readonly fetchEngines: SearchEngine[];
    private readonly blocked: RegExp | undefined;

    constructor(
        configs: EngineConfig[],
        selected: string[],
        private readonly strategy: "auto" | "parallel",
        private readonly options: SearchConfig,
        ctx?: Context,
    ) {
        const ids = new Set<string>();
        for (const config of configs) {
            if (!config.id.trim() || config.id !== config.id.trim() || ids.has(config.id)) throw new Error("搜索引擎名称必须非空且唯一");
            ids.add(config.id);
        }
        if (selected.some((id) => !ids.has(id))) throw new Error("请选择仍存在的搜索引擎");
        const enabled = new Set(selected);
        const chosen = configs.filter((config) => enabled.has(config.id));
        for (const config of chosen) normalizeUrl(config.endpoint);
        this.engines = createEngines(chosen, options.timeoutMs, ctx);
        this.fetchEngines = this.engines.filter((engine) => engine.fetchPage);
        this.blocked = compileBlacklist(options.blacklist);
    }

    get canSearch() {
        return this.engines.length > 0;
    }

    get canFetch() {
        return this.fetchEngines.length > 0;
    }

    async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchOutput> {
        if (!query.trim() || !this.canSearch) throw new Error("搜索词为空或没有启用搜索引擎");
        const deadline = timeoutSignal(signal, this.options.totalTimeoutMs);
        const attempt = async (engine: SearchEngine) => {
            try {
                deadline.throwIfAborted();
                const raw = await engine.search!({ query, limit, signal: deadline });
                deadline.throwIfAborted();
                const hits = mergeHits(raw.results).filter((hit) => !isBlocked(hit.url, this.blocked));
                const result: EngineSearchResult = { results: hits, answers: raw.answers };
                const status = hits.length ? "success" : "empty";
                return { result, receipt: { engine: engine.id, count: hits.length, status } satisfies SearchAttempt, retryable: false };
            } catch (error) {
                signal?.throwIfAborted();
                const { message, retryable } = describeEngineFailure(deadline.aborted ? deadline.reason : error);
                return { receipt: { engine: engine.id, count: 0, status: "failed", error: message } satisfies SearchAttempt, retryable };
            }
        };
        const finished: Array<Awaited<ReturnType<typeof attempt>>> = [];
        if (this.strategy === "parallel") {
            finished.push(...(await Promise.all(this.engines.map(attempt))));
        } else {
            for (const engine of this.engines) {
                const item = await attempt(engine);
                finished.push(item);
                if (deadline.aborted || item.result?.results.length) break;
            }
        }
        signal?.throwIfAborted();
        const attempts = finished.map(({ receipt }) => receipt);
        if (!finished.some((item) => item.result) || (deadline.aborted && !finished.some((item) => item.result?.results.length))) {
            throw new SearchDispatchError(attempts, !deadline.aborted && finished.some((item) => item.retryable));
        }
        return {
            results: mergeHits(finished.flatMap(({ result }) => result?.results ?? []))
                .slice(0, limit)
                .map((hit) => ({ ...hit, snippet: truncate(hit.snippet, this.options.maxSnippetChars) })),
            answers: capAnswers(
                finished.flatMap(({ result }) => result?.answers ?? []),
                this.options.maxAnswerChars,
            ),
            attempts,
        };
    }

    async fetch(inputs: string[], maxChars: number, signal?: AbortSignal): Promise<FetchOutput> {
        if (!inputs.length || inputs.length > this.options.maxFetchUrls) throw new Error(`请提供 1 到 ${this.options.maxFetchUrls} 个 URL`);
        const deadline = timeoutSignal(signal, this.options.totalTimeoutMs);
        const seen = new Set<string>();
        const results: FetchOutput["results"] = [];
        for (const value of inputs) {
            signal?.throwIfAborted();
            let url: string;
            try {
                url = validatedUrl(value).href;
            } catch {
                results.push({ url: "无效 URL", error: "请输入不包含凭证的 HTTP 或 HTTPS 地址" });
                continue;
            }
            if (seen.has(url)) continue;
            seen.add(url);
            if (isBlocked(url, this.blocked)) {
                results.push({ url, error: "该地址被配置过滤" });
                continue;
            }
            try {
                const { page, engine } = await this.fetchPage(url, deadline);
                results.push({ url, engine, title: page.title || url, content: truncate(page.content, Math.min(maxChars, this.options.maxContentChars)) });
            } catch (error) {
                signal?.throwIfAborted();
                results.push({
                    url,
                    error:
                        error instanceof SearchDispatchError
                            ? error.attempts.map((item) => `${item.engine}：${item.error}`).join("，")
                            : describeEngineFailure(error).message,
                });
            }
        }
        return { results };
    }

    private async fetchPage(url: string, signal: AbortSignal) {
        const fetch = async (engine: SearchEngine, requestSignal: AbortSignal) => {
            requestSignal.throwIfAborted();
            const page = await engine.fetchPage!(url, requestSignal);
            requestSignal.throwIfAborted();
            return { engine: engine.id, page };
        };
        if (this.strategy === "parallel") {
            const race = new AbortController();
            const requestSignal = AbortSignal.any([signal, race.signal]);
            try {
                return await Promise.any(this.fetchEngines.map((engine) => fetch(engine, requestSignal)));
            } catch (error) {
                if (!(error instanceof AggregateError)) throw error;
                throw new SearchDispatchError(
                    this.fetchEngines.map((engine, index) => ({
                        engine: engine.id,
                        count: 0,
                        status: "failed",
                        error: describeEngineFailure(error.errors[index]).message,
                    })),
                    false,
                );
            } finally {
                race.abort();
            }
        }

        const errors: SearchAttempt[] = [];
        for (const engine of this.fetchEngines) {
            try {
                return await fetch(engine, signal);
            } catch (error) {
                errors.push({ engine: engine.id, count: 0, status: "failed", error: describeEngineFailure(error).message });
                if (signal.aborted) break;
            }
        }
        throw new SearchDispatchError(errors, false);
    }
}
