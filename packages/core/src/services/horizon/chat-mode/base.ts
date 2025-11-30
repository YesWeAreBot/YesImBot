import type { Context } from "koishi";
import type { ChatMode } from "./types";

export abstract class BaseChatMode implements ChatMode {
    abstract name: string;
    abstract priority: number;
    constructor(protected ctx: Context) {}
    abstract match(percept: any, ctx: Context): Promise<boolean> | boolean;
    abstract buildContext(percept: any, ctx: Context): Promise<any>;
}
