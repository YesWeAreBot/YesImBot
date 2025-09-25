import { PGliteDriver } from "@yesimbot/driver-pglite";
import {
    Create,
    Database,
    Driver,
    Field,
    FlatKeys,
    FlatPick,
    Model,
    Tables as MTables,
    Types as MTypes,
    Query,
    Relation,
    Selection,
    Values,
} from "@yesimbot/minato";
import { Context, Schema, Service } from "koishi";
import { EmbedModel, ModelDescriptor, Services } from "koishi-plugin-yesimbot";
import path from "path";
import enUS from "./locales/en-US.yml";
import zhCN from "./locales/zh-CN.yml";

declare module "koishi" {
    interface Services {
        "yesimbot-vector-store": VectorStoreService;
    }
}

export interface Types extends MTypes {
    vector: number[];
}

export interface Tables extends MTables {}

export interface Config {
    path: string;
    dimension: number;
    embeddingModel?: ModelDescriptor;
}

export interface VectorStore {
    create: Database<Tables, Types>["create"];
    extend: Database<Tables, Types>["extend"];
    get: Database<Tables, Types>["get"];
    remove: Database<Tables, Types>["remove"];
    select: Database<Tables, Types>["select"];
}

export default class VectorStoreService extends Service<Config> implements VectorStore {
    static readonly Config: Schema<Config> = Schema.object({
        path: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot/vector-store/pgdata"),
        dimension: Schema.number().default(1536),
        embeddingModel: Schema.dynamic("modelService.embeddingModels"),
    }).i18n({
        "en-US": enUS,
        "zh-CN": zhCN,
    });

    static readonly inject = [Services.Model];

    private db: Database<Tables, Types>;
    private embedModel!: EmbedModel;
    private driver!: PGliteDriver;
    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot-vector-store");
        this.config = config;
        this.db = new Database();
    }

    async start() {
        await this.db.connect(PGliteDriver, {
            dataDir: path.resolve(this.ctx.baseDir, this.config.path),
        });

        this.driver = this.db.drivers[0] as PGliteDriver;

        try {
            if (this.config.embeddingModel) {
                this.embedModel = this.ctx[Services.Model].getEmbedModel(this.config.embeddingModel) as EmbedModel;
            }
        } catch (error: any) {
            this.logger.warn(error.message);
        }

        this.logger.info("Vector store is ready.");
    }

    query<T extends any[] = any[]>(sql: string): Promise<T> {
        return this.driver.query<T>(sql);
    }

    create<K extends keyof Tables>(table: K, data: Create<Tables[K], Tables>): Promise<Tables[K]> {
        return this.db.create(table, data);
    }

    extend<K extends keyof Tables>(
        name: K,
        fields: Field.Extension<Tables[K], Types>,
        config?: Partial<Model.Config<FlatKeys<Tables[K]>>>
    ): void {
        this.db.extend(name, fields, config);
    }

    get<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<Tables[K][]>;
    get<K extends keyof Tables, P extends FlatKeys<Tables[K]> = any>(
        table: K,
        query: Query<Tables[K]>,
        cursor?: Driver.Cursor<P, Tables, K>
    ): Promise<FlatPick<Tables[K], P>[]> {
        return this.db.get(table, query, cursor);
    }

    remove<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<Driver.WriteResult> {
        return this.db.remove(table, query);
    }

    select<T>(table: Selection<T>, query?: Query<T>): Selection<T>;
    select<K extends keyof Tables>(
        table: K,
        query?: Query<Tables[K]>,
        include?: Relation.Include<Tables[K], Values<Tables>> | null
    ): Selection<Tables[K]> {
        return this.db.select(table, query, include);
    }
}
