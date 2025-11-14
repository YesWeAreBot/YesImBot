import type { Awaitable, Context } from "koishi";
import type { TelemetryConfig } from "./config";
import Sentry from "@sentry/node";
import { Service } from "koishi";
import { Services } from "@/shared/constants";

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
