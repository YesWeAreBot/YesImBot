import { Context } from "koishi";

import { MemoryError } from "./MemoryError";
import { MEMORY_TABLE } from "./config";
import { MemoryBlockData } from "./types";

export interface IMemoryBlockStore {
    load(id: string, label: string): Promise<MemoryBlockData | null>;
    save(data: MemoryBlockData): Promise<void>;
    remove(id: string, label: string): Promise<void>;
    exists(id: string, label: string): Promise<boolean>;
}

export class DatabaseMemoryBlockStore implements IMemoryBlockStore {
    constructor(private readonly ctx: Context) {}

    async load(id: string, label: string): Promise<MemoryBlockData | null> {
        try {
            const [result] = await this.ctx.database.get(MEMORY_TABLE, { id, label });
            if (result) {
                return {
                    id: result.id,
                    label: result.label,
                    content: Array.isArray(result.content) ? result.content : [],
                    limit: result.limit,
                };
            }
            return null;
        } catch (error) {
            const errMsg = `DatabaseStore: Failed to load memory block ${label} (ID: ${id}): ${error.message}`;
            this.ctx.logger.error(errMsg);
            throw new MemoryError(errMsg, { id, label, error });
        }
    }

    async save(data: MemoryBlockData): Promise<void> {
        try {
            await this.ctx.database.upsert(MEMORY_TABLE, [
                {
                    id: data.id,
                    label: data.label,
                    content: data.content,
                    limit: data.limit,
                },
            ]);
            this.ctx.logger.debug(`DatabaseStore: Saved memory block ${data.label} (ID: ${data.id})`);
        } catch (error) {
            const errMsg = `DatabaseStore: Failed to save memory block ${data.label} (ID: ${data.id}): ${error.message}`;
            this.ctx.logger.error(errMsg);
            throw new MemoryError(errMsg, { id: data.id, label: data.label, error });
        }
    }

    async remove(id: string, label: string): Promise<void> {
        try {
            await this.ctx.database.remove(MEMORY_TABLE, { id, label });
            this.ctx.logger.debug(`DatabaseStore: Removed memory block ${label} (ID: ${id})`);
        } catch (error) {
            const errMsg = `DatabaseStore: Failed to remove memory block ${label} (ID: ${id}): ${error.message}`;
            this.ctx.logger.error(errMsg);
            throw new MemoryError(errMsg, { id, label, error });
        }
    }

    async exists(id: string, label: string): Promise<boolean> {
        try {
            const [result] = await this.ctx.database.get(MEMORY_TABLE, { id, label });
            return !!result;
        } catch (error) {
            const errMsg = `DatabaseStore: Failed to check existence for ${label} (ID: ${id}): ${error.message}`;
            this.ctx.logger.error(errMsg);
            throw new MemoryError(errMsg, { id, label, error });
        }
    }
}
