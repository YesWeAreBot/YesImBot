export interface WillingnessPolicyConfig {
    algorithm: "legacy" | "balanced";
    windowSeconds: number;
    ordinaryGainLimit: number;
    decisionIntervalSeconds: number;
    othersPenalty: number;
    negativeGainLimit: number;
    replyPenalty: number;
    replyPenaltyHalfLifeSeconds: number;
}

export const DEFAULT_WILLINGNESS_POLICY: WillingnessPolicyConfig = {
    algorithm: "legacy",
    windowSeconds: 60,
    ordinaryGainLimit: 24,
    decisionIntervalSeconds: 10,
    othersPenalty: 12,
    negativeGainLimit: 24,
    replyPenalty: 12,
    replyPenaltyHalfLifeSeconds: 30,
};

export interface BalancedTrace {
    version: "balanced-v1";
    invited: boolean;
    addressesOthers: boolean;
    preview: boolean;
    decay: number;
    requestedGain: number;
    positiveGain: number;
    negativeGain: number;
    limitedGain: number;
    ordinaryGainRemaining: number;
    negativeGainRemaining: number;
    fatiguePenalty: number;
    rawProbability: number;
    gate: "none" | "opportunity_interval" | "recent_reply_pressure";
}
interface ChannelState {
    ordinaryRemaining: number;
    negativeRemaining: number;
    budgetAt: number;
    pressure: number;
    pressureAt: number;
    opportunityAt?: number;
}

/** Invalid raw runtime values fall back to finite defaults; old configurations stay legacy. */
export function resolveWillingnessPolicy(input?: Partial<WillingnessPolicyConfig>): WillingnessPolicyConfig {
    const config = { ...DEFAULT_WILLINGNESS_POLICY };
    config.algorithm = input?.algorithm === "balanced" ? "balanced" : "legacy";
    for (const field of [
        "windowSeconds",
        "ordinaryGainLimit",
        "decisionIntervalSeconds",
        "othersPenalty",
        "negativeGainLimit",
        "replyPenalty",
        "replyPenaltyHalfLifeSeconds",
    ] as const) {
        const value = input?.[field];
        const minimum = field === "windowSeconds" || field === "replyPenaltyHalfLifeSeconds" ? 1 : 0;
        if (typeof value === "number" && Number.isFinite(value) && value >= minimum) config[field] = Math.min(value, 1_000_000);
    }
    return config;
}
export const nonnegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
export const linearProbability = (score: number, threshold: number, amplifier: number) =>
    Math.max(0, Math.min(1, (score - nonnegative(threshold)) * nonnegative(amplifier)));

/** O(1) per message: separate replenishing budgets and a decaying successful-reply pressure. */
export class BalancedWillingnessPolicy {
    private channels = new Map<string, ChannelState>();
    private channel(key: string, config: WillingnessPolicyConfig, now: number): ChannelState {
        let state = this.channels.get(key);
        if (!state) {
            state = { ordinaryRemaining: config.ordinaryGainLimit, negativeRemaining: config.negativeGainLimit, budgetAt: now, pressure: 0, pressureAt: now };
            this.channels.set(key, state);
        }
        const elapsed = Math.max(0, now - state.budgetAt) / (config.windowSeconds * 1000);
        state.ordinaryRemaining = Math.min(config.ordinaryGainLimit, state.ordinaryRemaining + elapsed * config.ordinaryGainLimit);
        state.negativeRemaining = Math.min(config.negativeGainLimit, state.negativeRemaining + elapsed * config.negativeGainLimit);
        state.budgetAt = Math.max(state.budgetAt, now);
        state.pressure *= 0.5 ** (Math.max(0, now - state.pressureAt) / (config.replyPenaltyHalfLifeSeconds * 1000));
        state.pressureAt = Math.max(state.pressureAt, now);
        return state;
    }
    public update(
        key: string,
        config: WillingnessPolicyConfig,
        input: {
            now: number;
            score: number;
            decay: number;
            max: number;
            requestedGain: number;
            invited: boolean;
            addressesOthers: boolean;
            preview?: boolean;
            deferWithdrawal?: boolean;
            threshold: number;
            amplifier: number;
        },
    ) {
        const state = this.channel(key, config, input.now);
        const requestedGain = nonnegative(input.requestedGain);
        let positiveGain = 0,
            negativeGain = 0;
        if (!input.preview) {
            if (input.addressesOthers) {
                negativeGain = input.deferWithdrawal ? 0 : Math.min(config.othersPenalty, state.negativeRemaining);
                state.negativeRemaining -= negativeGain;
            } else {
                positiveGain = input.invited ? requestedGain : Math.min(requestedGain, state.ordinaryRemaining);
                if (!input.invited) state.ordinaryRemaining -= positiveGain;
            }
        }
        const after = Math.max(0, Math.min(input.max, input.score + positiveGain - negativeGain));
        const fatiguePenalty = input.invited ? 0 : Math.min(input.max, state.pressure * config.replyPenalty);
        const rawProbability = linearProbability(after, input.threshold, input.amplifier);
        const probability = linearProbability(Math.max(0, after - fatiguePenalty), input.threshold, input.amplifier);
        const trace: BalancedTrace = {
            version: "balanced-v1",
            invited: input.invited,
            addressesOthers: input.addressesOthers,
            preview: !!input.preview,
            decay: input.decay,
            requestedGain,
            positiveGain,
            negativeGain,
            limitedGain: input.preview || input.addressesOthers ? 0 : Math.max(0, requestedGain - positiveGain),
            ordinaryGainRemaining: state.ordinaryRemaining,
            negativeGainRemaining: state.negativeRemaining,
            fatiguePenalty,
            rawProbability,
            gate: rawProbability > 0 && probability === 0 ? "recent_reply_pressure" : "none",
        };
        return { after, probability, trace };
    }
    public opportunity(key: string, config: WillingnessPolicyConfig, probability: number, invited: boolean, now: number): boolean {
        if (invited || probability <= 0) return true;
        const state = this.channel(key, config, now);
        if (state.opportunityAt !== undefined && now - state.opportunityAt < config.decisionIntervalSeconds * 1000) return false;
        state.opportunityAt = Math.max(state.opportunityAt ?? now, now);
        return true;
    }
    public replied(key: string, config: WillingnessPolicyConfig, now: number) {
        const state = this.channel(key, config, now);
        state.pressure = Math.min(100, state.pressure + 1);
    }
    public reset(key: string) {
        this.channels.delete(key);
    }
    public clear() {
        this.channels.clear();
    }
}
