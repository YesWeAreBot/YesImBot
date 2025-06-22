import { Context, Logger } from "koishi";

export interface ArchivalEntry {
    id: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface ArchivalSearchResult {
    results: ArchivalEntry[];
    total: number;
}

export interface IArchivalMemoryStore {
    store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry>;
    retrieve(id: string): Promise<ArchivalEntry | null>;
    search(
        query: string,
        options?: {
            page?: number;
            pageSize?: number;
            filterMetadata?: Record<string, any>;
        }
    ): Promise<ArchivalSearchResult>;
    remove(id: string): Promise<boolean>;
    count(): Promise<number>;
    clearAll?(): Promise<void>;
    renderEntryText(entry: ArchivalEntry): string;
}

export class InMemoryArchivalStore implements IArchivalMemoryStore {
    private entries: Map<string, ArchivalEntry> = new Map();
    private readonly logger: Logger;

    constructor(ctx: Context) {
        this.logger = ctx.logger(InMemoryArchivalStore.name);
    }

    async store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        const id = `archival-mem-${Date.now()}-${Math.random().toString(36).substring(2)}`;
        const entry: ArchivalEntry = { id, content, timestamp: new Date(), metadata };
        this.entries.set(id, entry);
        this.logger.debug(`Stored archival entry ID: ${id}`);
        return entry;
    }

    async retrieve(id: string): Promise<ArchivalEntry | null> {
        return this.entries.get(id) || null;
    }

    async search(
        query: string,
        options: { page?: number; pageSize?: number; filterMetadata?: Record<string, any> } = {}
    ): Promise<ArchivalSearchResult> {
        const { page = 1, pageSize = 10, filterMetadata } = options;
        const lowerQuery = query.toLowerCase();

        let matched = Array.from(this.entries.values()).filter((entry) => {
            const contentMatch = entry.content.toLowerCase().includes(lowerQuery);
            let metadataMatch = true;
            if (filterMetadata) {
                metadataMatch = Object.entries(filterMetadata).every(
                    ([key, value]) => entry.metadata && String(entry.metadata[key]).toLowerCase() === String(value).toLowerCase()
                );
            }
            return contentMatch && metadataMatch;
        });
        matched.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        const total = matched.length;
        const offset = (page - 1) * pageSize;
        const paginatedResults = matched.slice(offset, offset + pageSize);

        this.logger.debug(`Searched archival for "${query}", found ${total} total, returning ${paginatedResults.length}.`);
        return { results: paginatedResults, total };
    }

    async remove(id: string): Promise<boolean> {
        return this.entries.delete(id);
    }

    async count(): Promise<number> {
        return this.entries.size;
    }

    async clearAll(): Promise<void> {
        this.entries.clear();
        this.logger.info("Cleared all in-memory archival entries.");
    }

    renderEntryText(entry: ArchivalEntry): string {
        let text = `[Archival ID: ${entry.id}, Timestamp: ${entry.timestamp.toISOString()}]`;
        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            text += `\n  Metadata: ${JSON.stringify(entry.metadata)}`;
        }
        // Provide a more substantial preview or full content based on LLM needs
        text += `\n  Content: ${entry.content}`;
        return text;
    }
}
