import { PGliteDriver } from "@yesimbot/driver-pglite";
import { Context, Service, Schema } from "koishi";
import * as minato from "minato";
import { Database, Driver, FlatKeys, Field, Query, Create, Model, Keys, Selection, Relation, Values } from "minato";
import path from "path";
import zhCN from "./locales/zh-CN.yml";
import enUS from "./locales/en-US.yml";

declare module "koishi" {
    interface Services {
        "yesimbot-vector-store": VectorStoreService;
    }
}

export interface Types extends minato.Types {
    vector: number[];
}

export interface Tables extends minato.Tables {}

export interface Config {
    path: string;
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
    }).i18n({
        "en-US": enUS,
        "zh-CN": zhCN,
    });

    private db: Database<Tables, Types>;

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

        this.driver.query;
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
    get<K extends keyof Tables, P extends minato.FlatKeys<Tables[K]> = any>(
        table: K,
        query: Query<Tables[K]>,
        cursor?: minato.Driver.Cursor<P, Tables, K>
    ): Promise<minato.FlatPick<Tables[K], P>[]> {
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
