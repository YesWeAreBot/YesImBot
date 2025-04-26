import { Context } from "koishi"
import { z } from "zod"

import { Tool, ToolManager } from "../src/extensions/base"


const toolManager = ToolManager.getInstance()

toolManager.loadExtensions(new Context().logger)

const Test = Tool({
    name: "test",
    description: `测试工具`,
    parameters: z.object({
        test: z.string().describe("测试参数")
    }),
    execute: async ({}, context) => {
        console.log(context)
    }
})

const Test2 = Tool({
    name: "test2",
    description: `测试工具2`,
    parameters: z.object({}),
    execute: async ({}, context) => {
        console.log(context)
    }
})

toolManager.registerTool(Test)
toolManager.registerTool(Test2)

const prompt = toolManager.getToolPrompts()


console.log(prompt)