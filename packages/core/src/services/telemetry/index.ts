import { Services } from "@/shared/constants";
import Sentry from "@sentry/node";
import { Awaitable, Context, Service } from "koishi";
import { TelemetryConfig } from "./config";

export { TelemetryConfig } from "./config";

declare module "koishi" {
    interface Services {
        [Services.Telemetry]: TelemetryService;
    }
}

export class TelemetryService extends Service<TelemetryConfig> {
    constructor(ctx: Context, config: TelemetryConfig) {
        super(ctx, Services.Telemetry, true);
        this.config = config;
    }

    start(): Awaitable<void> {
        if (this.config.enabled && this.config.dsn) {
            Sentry.init({
                ...this.config,
            });
        }
    }

    stop(): Awaitable<void> {
        Sentry.close();
    }

    captureException(error: Error) {
        Sentry.captureException(error);
    }
}
