import { z } from "zod";

import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Tool } from "../base";


export const ViewImage = Tool({
    name: "view_image",
    description: "获取聊天记录中指定图片内容的详细描述。当对话需要你理解图片内容才能做出响应时调用此工具。",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        image_id: z.string().describe("聊天记录中图片的唯一ID，例如从'[图片#12345]'中提取的'12345'。"),
        query: z.string().describe("你希望了解图片的具体内容或方面。例如：'描述图片主要内容'，'图片中有哪些文字？'，'人物的表情是什么？'。如果不指定，将提供一个通用描述。").optional(),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute({image_id, query}, context) {
        return Failed("")
    }
})
