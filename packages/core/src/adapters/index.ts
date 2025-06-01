import { Provider } from "./base";
import { ChatModel } from "./chat";
import { Provider as ProviderConfig, ModelSetting } from "./config";

export class ChatModelSwitcher {
    private provider: Provider[] = [];
    private current = 0;
    private useModel: [number, number][];

    constructor(providerConfig: ProviderConfig[], useModel: [number, number][], modelSetting: ModelSetting) {
        this.useModel = useModel;
        for (let prov of providerConfig) {
            this.provider.push(new Provider(prov, modelSetting));
        }
    }

    public get length() {
        return this.useModel.length;
    }

    public getModel(useModel?: [number, number]): ChatModel {
        try {
            if (useModel) return this.provider[useModel[0]].getChatModel(useModel[1]);

            if (this.current >= this.useModel.length) this.current = 0;
            let model = this.useModel[this.current++];
            const prov = this.provider[model[0]]; // 获取对应提供商
            const chatModel = prov.getChatModel(model[1]); // 从提供商获取模型
            return chatModel;
        } catch (error) {
            return;
        }
    }
}
