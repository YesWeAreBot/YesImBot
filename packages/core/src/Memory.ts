import { Scenario } from "./Scenario";
import { isEmpty } from "./utils/string";

export class Memory {
    // 记忆块列表
    coreMemory: MemoryBlock[];

    recallMemory: Scenario[];

    archivalMemory: MemoryBlock[];

    lastModified: Date;

    constructor() {
        this.coreMemory = [];
        this.recallMemory = [];
        this.archivalMemory = [];
        this.lastModified = new Date();
    }

    async appendCoreMemory(label: "human" | "persona", content: string) {
        if (isEmpty(content)) {
            return;
        }
        const memoryBlock = this.coreMemory.find((memoryBlock) => memoryBlock.type === label);
        if (memoryBlock) {
            memoryBlock.append(label, content); 
        } else {
            this.coreMemory.push(new MemoryBlock(label, label, [content]));
        }
        this.lastModified = new Date();
        return "Memory appended successfully."
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
        return `### Memory [last modified: 2024-12-16 12:48:37 PM 中国标准时间+0800]
4 previous messages between you and the user are stored in recall memory (use functions to access them)
0 total memories you created are stored in archival memory (use functions to access them)

Core memory shown below (limited in size, additional information stored in archival / recall memory):
${this.coreMemory.map((memoryBlock) => memoryBlock.render()).join("\n")}`;
    }
}

export class MemoryBlock {
    // 记忆块ID
    id: string;
    // 记忆块类型
    type: "human" | "persona";
    // 记忆块内容
    content: string[];
    // 更新时间
    updatedAt: Date;
    // 记忆块大小，以字符串长度计算
    size: number;

    /**
     * 从数据库中获取记忆块，如果不存在则创建一个新的记忆块
     * @param id
     */
    static async getMemoryBlock(id: string) {
        throw new Error("Not implemented");
    }

    constructor(id: string, type: "human" | "persona", content: string[]) {
        this.id = id;
        this.type = type;
        this.content = content;
    }

    /**
     * 序列化记忆块
     */
    serialize() {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            updatedAt: this.updatedAt,
            size: this.size,
        };
    }

    /**
     * 从序列化数据中恢复记忆块
     * @param data
     */
    static deserialize(data: any) {
        const memoryBlock = new MemoryBlock(data.id, data.type, data.content);
        memoryBlock.updatedAt = new Date(data.updatedAt);
        memoryBlock.size = data.size;
        return memoryBlock;
    }

    /**
     * Append to the contents of core memory(core_memory_append).
     * @param label Section of the memory to be edited (persona or human).
     * @param content Content to write to the memory.
     */
    append(label: string, content: string) {
        if (isEmpty(content)) {
            return;
        }
        this.content.push(content);
        this.size = this.content.join("\n").length;
        this.updatedAt = new Date();
    }

    /**
     * Replace the contents of core memory. To delete memories, use an empty string for new_content(core_memory_replace).
     * @param label Section of the memory to be edited (persona or human).
     * @param old_content String to replace. Must be an exact match.
     * @param new_content Content to write to the memory.
     */
    replace(label: string, old_content: string, new_content: string) {
        // 从记忆内容中搜索
        const index = this.content.findIndex((item) => item === old_content);
        if (index === -1) {
            throw new Error("Memory not found");
        }
        if (isEmpty(new_content)) {
            this.content.splice(index, 1);
        } else {
            this.content[index] = new_content;
        }

        // 更新记忆块大小
        this.size = this.content.join("\n").length;

        // 更新时间
        this.updatedAt = new Date();
    }

    render() {
        return `
<${this.type} characters="${this.size}">
${this.content.join("\n")}
</${this.type}>`;
    }
}
