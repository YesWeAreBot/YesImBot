import { h } from "koishi";
import { z } from "zod";

import { isEmpty } from "../utils/string";
import { Tool, Failed, Success } from "./base";


interface OcrResult {
    status: string
    retcode: number
    data: {
        texts: {
            text: string        // 文本
            confidence: number  // 匹配率
            coordinates: {
                x: number
                y: number
            }[]                 // 位置列表
        }
        language: string        // 语言
    }
}

export const OneBotOcr = Tool({
    name: "onebot_ocr",
    description: `OCR图像识别`,
    parameters: z.object({
        inner_thoughts: z.string().describe("The inner thoughts of the conversation."),
        image: z.string().describe("image 链接, 支持 http/https/file/base64"),
        request_heartbeat: z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.")
    }),
    execute: async ({ image }, context) => {
        if (isEmpty(image)) throw new Error("image is required");
        const { ctx, session } = context;
        try {
            //@ts-ignore
            if (!session.onebot) {
                return Failed(`当前平台不支持OCR`);
            }
            //@ts-ignore
            let result: OcrResult = await session.onebot._request("ocr_image", { image });
            if (result.status === "ok") {
                return Success(result.data);
            } else {
                return Failed(`OCR失败: ${result.status} ${result.retcode}`);
            }
        } catch (e) {
            return Failed(`OCR失败: ${e.message}`);
        }
    }
})
