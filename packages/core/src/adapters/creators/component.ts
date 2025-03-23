/**
 * 表示一个组件的基本接口。
 */
export interface Component {
    type: string
}

export interface TextComponent extends Component {
    type: "text";
    text: string;
}

export function TextComponent(text: string): TextComponent {
    return { type: "text", text };
}

export interface ImageComponent extends Component {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "low" | "high" | "auto";
    };
}

/**
 * 创建一个图片组件。
 * @param url - 图片的 URL，可以为base64编码。
 * @param detail - 图片的详细程度，默认为 "auto"。
 * @returns 一个图片组件对象。
 */
export function ImageComponent(
    url: string,
    detail: "low" | "high" | "auto" = "auto"
): ImageComponent {
    return { type: "image_url", image_url: { url, detail } };
}

export interface Message {
    role: "system" | "assistant" | "user" | "tool";
    content: string | Component[];
}

export interface SystemMessage extends Message {
    role: "system";
}

export interface UserMessage extends Message {
    role: "user";
}

export interface AssistantMessage extends Message {
    role: "assistant";
    content: string;
    tool_calls?: ToolCall[];
    prefix?: boolean;
}

export interface ToolMessage extends Message {
    role: "tool";
    content: string;
    tool_call_id: string;
}

export interface ToolCall {
    id: string;
    index: number;
    type: "function";
    function: {
        name: string;
        arguments: { [key: string]: string };
    }
}

/**
 * 包装消息内容。
 * @param content - 消息内容数组，包含字符串或组件。
 * @returns 包装后的消息内容，可以是字符串或组件数组。
 */
function wrapContent(content: Array<string | Component>): string | Component[] {
    // 如果数组中只有一个元素且为字符串，则直接返回该字符串
    if (content.length === 1 && typeof content[0] === "string") {
        return content[0];
    }
    // 否则将数组中的每个元素转换为组件（如果是字符串则转换为文本组件）
    return content.map((it) => (typeof it === "string" ? TextComponent(it) : it));
}

export function SystemMessage(
    ...content: Array<string | Component>
): SystemMessage {
    const wrappedContent = wrapContent(content);
    return {
        role: "system",
        content: wrappedContent,
    };
}

export function UserMessage(
    ...content: Array<string | Component>
): UserMessage {
    const wrappedContent = wrapContent(content);
    return {
        role: "user",
        content: wrappedContent,
    };
}

export function AssistantMessage(
    ...content: Array<string | Component>
): AssistantMessage {
    const wrappedContent = wrapContent(content);
    return {
        role: "assistant",
        content: wrappedContent as string,
    };
}

/**
 * 创建一个工具消息。
 * @param content - 消息内容，为字符串类型。
 * @param tool_call_id - 工具调用的 ID。
 * @returns 一个工具消息对象。
 */
export function ToolMessage(content: string, tool_call_id: string): ToolMessage {
    return {
        role: "tool",
        content,
        tool_call_id
    };
}
