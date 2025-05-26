import { BaseAdapter, UniversalAdapter } from "./base";
import { LLMConfig, LLMParameters } from "./config";


export class AdapterSwitcher {
    private adapters: BaseAdapter[];
    private current = 0;
    constructor(
        adapterConfig: LLMConfig[],
        parameters: LLMParameters,
    ) {
        this.updateConfig(adapterConfig, parameters);
    }

    public get length() {
        return this.adapters.length;
    }

    public getAdapter() {
        try {
            if (this.current >= this.adapters.length) this.current = 0;
            return { current: this.current, adapter: this.adapters[this.current++] };
        } catch (error) {
            return;
        }
    }

    public updateConfig(
        adapterConfig: LLMConfig[],
        parameters: LLMParameters,
    ) {
        this.adapters = [];
        for (const adapter of adapterConfig) {
            if (!adapter.Enabled) continue;
            this.adapters.push(new UniversalAdapter(adapter, parameters));
        }
    }
}
