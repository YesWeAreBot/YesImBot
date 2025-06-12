import { Context, Service } from "koishi";
import { Provider } from "./base";
import { ChatModel } from "./chat";
import { ModelSetting, Provider as ProviderConfig } from "./config";

export class ChatModelSwitcher {
    private currentIndex = 0;

    constructor(private providers: Provider[], private useModel: [number, number][]) {}

    public get length() {
        return this.useModel.length;
    }

    public getCurrent(): ChatModel {
        try {
            let model = this.useModel[this.currentIndex];
            const prov = this.providers[model[0]];
            const chatModel = prov.getChatModel(model[1]);
            return chatModel;
        } catch (error) {
            return;
        }
    }

    public switchToNext(): ChatModel {
        this.currentIndex = (this.currentIndex + 1) % this.useModel.length;
        return this.getCurrent();
    }
}

interface ModelServiceConfig {
    providerConfig: ProviderConfig[];
    modelSetting: ModelSetting;
}

declare module "koishi" {
    interface Context {
        "yesimbot.model": ModelService;
    }
}

export class ModelService extends Service {
    private providers: Provider[] = [];

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, "yesimbot.model", true);

        for (let prov of config.providerConfig) {
            this.providers.push(new Provider(prov, config.modelSetting));
        }
    }

    getChatModel(useModel: [number, number] = [0, 0]): ChatModel {
        if (useModel) return this.providers[useModel[0]]?.getChatModel(useModel[1]);
    }

    getChatModelSwitcher(useModel: [number, number][]) {
        return new ChatModelSwitcher(this.providers, useModel);
    }
}
