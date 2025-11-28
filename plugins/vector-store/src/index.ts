import { Context, Schema, Service } from "koishi";

interface VectorStore {}

interface Config {}

export default class VectorStoreService extends Service<Config> implements VectorStore {
    static readonly Config: Schema<Config> = Schema.object({})

    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot-vector-store");
        this.config = config;
    }
}
