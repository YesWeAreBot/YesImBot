import { Provider } from "./base";
import { ChatModel } from "./chat";
import { Provider as ProviderConfig, ModelSetting } from "./config";
import { Context, Service } from "koishi";

export class ChatModelSwitcher {
    private current = 0;

    constructor(private providers: Provider[], private useModel: [number, number][]) {}

    public get length() {
        return this.useModel.length;
    }

    public getModel(): ChatModel {
        try {
            if (this.current >= this.useModel.length) this.current = 0;
            let model = this.useModel[this.current++];
            const prov = this.providers[model[0]]; // 获取对应提供商
            const chatModel = prov.getChatModel(model[1]); // 从提供商获取模型
            return chatModel;
        } catch (error) {
            return;
        }
    }
}

interface ModelServiceConfig {
    providerConfig: ProviderConfig[];
    modelSetting: ModelSetting;
}

declare module "koishi" {
    interface Context {
        ModelService: ModelService;
    }
}

export class ModelService extends Service {
    private providers: Provider[] = [];

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, "ModelService", true);

        for (let prov of config.providerConfig) {
            this.providers.push(new Provider(prov, config.modelSetting));
        }
    }

    getChatModel(useModel: [number, number]): ChatModel {
        if (useModel) return this.providers[useModel[0]].getChatModel(useModel[1]);
    }

    getChatModelSwitcher(useModel: [number, number][]) {
        return new ChatModelSwitcher(this.providers, useModel);
    }
}
