import { Context } from "koishi";
import { Config } from "../config";
import { ToolManager } from "../extensions";

export class ServiceContainer {
    private services = new Map<string, any>();

    register<T>(name: string, instance: T): this {
        this.services.set(name, instance);
        return this;
    }

    get<T>(name: string): T {
        if (!this.services.has(name)) {
            throw new Error(`Service '${name}' not found in container`);
        }
        return this.services.get(name) as T;
    }
}
