import { BaseAdapter, UniversalAdapter } from "./base";
import { Config } from "./config";


export class AdapterSwitcher {
    private adapters: BaseAdapter[];
    private current = 0;
    constructor(
        adapterConfig: Config["APIList"],
        parameters: Config["Parameters"]
    ) {
        this.updateConfig(adapterConfig, parameters);
    }

    getAdapter() {
        try {
            if (this.current >= this.adapters.length) this.current = 0;
            return { current: this.current, adapter: this.adapters[this.current++] };
        } catch (error) {
            return;
        }
    }

    updateConfig(
        adapterConfig: Config["APIList"],
        parameters: Config["Parameters"]
    ) {
        this.adapters = [];
        for (const adapter of adapterConfig) {
            if (!adapter.Enabled) continue;
            this.adapters.push(new UniversalAdapter(adapter, parameters));
        }
    }
}

export type { LLMConfig } from "./config";
