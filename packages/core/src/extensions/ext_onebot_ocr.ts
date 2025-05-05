import { z } from "zod";

import { isEmpty } from "../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "./base";


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
        INNER_THOUGHTS,
        image: z.string().describe("image 链接, 支持 http/https/file/base64"),
        REQUEST_HEARTBEAT,
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
