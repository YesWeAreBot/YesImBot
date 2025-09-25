import Sentry from "@sentry/node";
import { Awaitable, Context, Schema, Service } from "koishi";

declare module "koishi" {
    interface Services {
        "yesimbot-telemetry": Telemetry;
    }
}

const name = "yesimbot-telemetry";
const usage = ``;

export interface Config extends Sentry.NodeOptions {
    dsn?: string;
}

export default class Telemetry extends Service<Config> {
    static readonly name = name;
    static readonly usage = usage;
    static readonly Config: Schema<Config> = Schema.object({
        enabled: Schema.boolean().default(true),
        dsn: Schema.string().role("link").default("https://4f1a29e9564b488285235c35f95ea590@sentry.nekohouse.cafe/1"),
        enableLogs: Schema.boolean().default(false),
        debug: Schema.boolean().default(false),
    });
    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot-telemetry");
        this.config = config;
        if (config.enabled && config.dsn) {
            Sentry.init({ dsn: config.dsn });
        }
    }

    start(): Awaitable<void> {
        if (this.config.dsn) {
            Sentry.init({
                ...this.config,
            });
        }

        const error = new Error("Test error from YesImBot");
        this.captureException(error);
    }

    stop(): Awaitable<void> {
        Sentry.close();
    }

    captureException(error: Error) {
        Sentry.captureException(error);
    }
}
