import { Scenario } from "./Scenario";
import { isEmpty } from "./utils/string";

export class Memory {
    // 记忆块列表
    coreMemory: MemoryBlock[];
    recallMemory: Scenario[];
    archivalMemory: MemoryBlock[];
    // 最后修改时间
    lastModified: Date;

    constructor() {
        this.coreMemory = [];
        this.recallMemory = [];
        this.archivalMemory = [];
        this.lastModified = new Date();
    }

    private getMemoryBlock(label: string): MemoryBlock {
        const memoryBlock = this.coreMemory.find((block) => block.label === label);
        if (!memoryBlock) {
            throw new Error("Memory block not found.");
        }
        return memoryBlock;
    }

    /**
     * Append to the contents of core memory(core_memory_append).
     * @param label Section of the memory to be edited (persona or human).
     * @param content Content to write to the memory.
     */
    async appendCoreMemory(label: string, content: string) {
        if (isEmpty(content)) return;
        const memoryBlock = this.getMemoryBlock(label);
        memoryBlock.append(content);
        this.lastModified = new Date();
        return "Memory appended successfully.";
    }

    /**
     * Replace the contents of core memory. To delete memories, use an empty string for new_content(core_memory_replace).
     * @param label Section of the memory to be edited (persona or human).
     * @param old_content String to replace. Must be an exact match.
     * @param new_content Content to write to the memory.
     */
    async replaceCoreMemory(label: string, old_content: string, new_content: string) {
        if (isEmpty(old_content)) {
            throw new Error("Old content cannot be empty.");
        }
        const memoryBlock = this.getMemoryBlock(label);
        memoryBlock.replace(old_content, new_content);
        this.lastModified = new Date();
    }

    /**
     * 渲染记忆
     * 
     * @example
     * ### Memory [last modified: 2024-12-16 12:48:37 PM 中国标准时间+0800]
     * 4 previous messages between you and the user are stored in recall memory (use functions to access them)
     * 2 total memories you created are stored in archival memory (use functions to access them)
     *
     * Core memory shown below (limited in size, additional information stored in archival / recall memory):
     * <persona characters="100/5000">
     * </persona>
     * <human characters="100/5000">
     * </human>
     */
    render() {
        return [
            `### Memory [last modified: ${this.lastModified.toLocaleString()}]`,
            `${this.recallMemory.length} previous messages between you and the user are stored in recall memory (use functions to access them)`,
            `${this.archivalMemory.length} total memories you created are stored in archival memory (use functions to access them)`,
            '',
            'Core memory shown below (limited in size, additional information stored in archival / recall memory):',
            '',
            ...this.coreMemory.map(memoryBlock => memoryBlock.render())
        ].join('\n');
    }
}

export class MemoryBlock {
    static EXISTING_LABELS = [];
    // 记忆块ID
    readonly id: string;
    // 记忆块标签
    readonly label: string;
    // 记忆块内容
    private value: string[];
    // 记忆块大小，以字符串长度计算
    public get size(): number {
        return this.value.join("")?.length || 0;
    }
    // 长度限制
    readonly limit: number;

    /**
     * 从数据库中获取记忆块，如果不存在则创建一个新的记忆块
     * @param id
     */
    static async getMemoryBlock(id: string) {
        throw new Error("Not implemented");
    }

    static async createMemoryBlock(label: string) {
        if (MemoryBlock.EXISTING_LABELS.includes(label)) {
            throw new Error("Label already exists");
        }
        else {
            MemoryBlock.EXISTING_LABELS.push(label);
            return new MemoryBlock(label, label, []);
        }
    }

    constructor(id: string, label: string, value: string[], limit = 5000) {
        this.id = id;
        this.label = label;
        this.value = value;
        this.limit = limit;
    }

    /**
     * 序列化记忆块
     */
    serialize() {
        return {
            id: this.id,
            label: this.label,
            value: this.value,
            size: this.size,
            limit: this.limit,
        };
    }

    /**
     * 从序列化数据中恢复记忆块
     * @param data
     */
    static deserialize(data: any) {
        const memoryBlock = new MemoryBlock(data.id, data.label, data.value, data.limit);
        return memoryBlock;
    }

    /**
     * 检查添加内容后是否超过长度限制
     * @param contentLength 
     */
    private checkMemoryLimit(contentLength: number) {
        if (this.size + contentLength > this.limit) {
            throw new Error("Memory limit exceeded");
        }
    }

    append(content: string) {
        this.checkMemoryLimit(content.length);
        this.value.push(content);
    }

    replace(old_content: string, new_content: string) {
        // 从记忆内容中搜索
        const index = this.value.findIndex((item) => item === old_content);
        if (index === -1) throw new Error("Memory not found");

        if (isEmpty(new_content)) {
            this.value.splice(index, 1);
        } else {
            this.checkMemoryLimit(new_content.length - (this.value[index]?.length || 0));
            this.value[index] = new_content;
        }
    }

    render(): string {
        return [
            `<${this.label} characters="${this.size}/${this.limit}">`,
            ...this.value,
            `</${this.label}>`
        ].join('\n');
    }
}
