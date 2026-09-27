export interface EvaluationRequestOptions {
    baseURL: string;
    apiKey: string;
    model: string;
}

export type EvaluationQuestion =
    | { type: "noul"; instructions?: string; criteria?: { true?: string; false?: string } }
    | { type: "choice"; instructions?: string; criteria: Record<string, string> }
    | { type: "score"; instructions?: string; criteria: string[] };
export type EvaluationQuestions = Record<string, EvaluationQuestion>;

export interface NoulAnswer { type: "noul"; noul: number }
export interface ChoiceAnswer { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
export interface ScoreAnswer { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
export type EvaluationAnswer<Q extends EvaluationQuestion> = Q extends { type: "noul" } ? NoulAnswer
    : Q extends { type: "choice" } ? ChoiceAnswer : ScoreAnswer;
export interface EvaluationResult<Q extends EvaluationQuestions> {
    model: string;
    answers: { [K in keyof Q]: EvaluationAnswer<Q[K]> };
    usage?: { input_tokens: number; output_tokens: number };
}
export interface EvaluationPostOptions {
    headers: Record<string, string>;
    signal?: AbortSignal;
    timeout?: number;
    redirect: "error";
}
export type EvaluationPost = (url: string, body: { model: string; state: unknown; questions: EvaluationQuestions }, options: EvaluationPostOptions) => Promise<unknown>;

const validProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function validAnswer(question: EvaluationQuestion, answer: unknown): boolean {
    if (!record(answer) || answer.type !== question.type)
        return false;
    if (question.type === "noul")
        return validProbability(answer.noul);
    if (!validProbability(answer.confidence) || !record(answer.probabilities))
        return false;
    const names = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
    if (Object.keys(answer.probabilities).length !== names.length || !names.every(name => validProbability((answer.probabilities as Record<string, unknown>)[name])))
        return false;
    if (question.type === "choice")
        return typeof answer.choice === "string" && names.includes(answer.choice);
    return typeof answer.score === "number" && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= names.length - 1
        && record(answer.legend) && names.every(name => (answer.legend as Record<string, unknown>)[name] === question.criteria[Number(name)]);
}

/** Execute the System One wire request, validating every requested answer. */
export async function evaluateQuestions<Q extends EvaluationQuestions>(
    options: EvaluationRequestOptions,
    request: { state: unknown; questions: Q },
    transport: { signal?: AbortSignal; timeoutMs?: number; post?: EvaluationPost } = {},
): Promise<EvaluationResult<Q>> {
    const url = `${options.baseURL.replace(/\/+$/, "")}/systemone`;
    const body = { model: options.model, state: request.state, questions: request.questions };
    const timeoutSignal = transport.timeoutMs && transport.timeoutMs > 0
        ? AbortSignal.timeout(transport.timeoutMs)
        : undefined;
    const signal = timeoutSignal && transport.signal
        ? AbortSignal.any([transport.signal, timeoutSignal])
        : timeoutSignal ?? transport.signal;
    const init: EvaluationPostOptions = {
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        signal,
        timeout: transport.timeoutMs,
        redirect: "error",
    };
    const post: EvaluationPost = transport.post ?? (async (endpoint, data, config) => {
        const response = await fetch(endpoint, {
            method: "POST", headers: config.headers, body: JSON.stringify(data), signal: config.signal, redirect: config.redirect,
        });
        if (!response.ok)
            throw new Error(`TypeSafe request failed with status ${response.status}`);
        return response.json();
    });
    const response = await post(url, body, init);
    if (!record(response) || !record(response.answers)
        || (response.model !== undefined && typeof response.model !== "string")
        || !Object.entries(request.questions).every(([name, question]) => validAnswer(question, (response.answers as Record<string, unknown>)[name]))) {
        throw new Error("Invalid TypeSafe evaluation response");
    }
    return { ...response, model: typeof response.model === "string" ? response.model : options.model } as unknown as EvaluationResult<Q>;
}
