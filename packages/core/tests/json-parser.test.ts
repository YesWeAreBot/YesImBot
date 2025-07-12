import { describe, it, expect } from "bun:test";
import { JsonParser } from "../src/shared/utils/json-parser";

interface ExpectedOutputType {
    name: string;
    age: number;
    isStudent: boolean;
    courses: string[];
}

interface ParseResult {
    thoughts: {
        observe: string;
        analyze_infer: string;
        plan: string;
    };
    actions: {
        function: string;
        params: any;
    }[];
    request_heartbeat: boolean;
}

describe("ParseResult", () => {
    const parser = new JsonParser<ParseResult>();

    it("应该能解析一个完美的 JSON 对象", () => {
        const input = `
        {
            "thoughts": {
                "observe": "用户'好奇宝宝'询问了关于大型语言模型的最新进展。",
                "analyze_infer": "这是一个知识性问题，需要使用外部工具来获取实时信息。",
                "plan": "我的计划是：首先，执行web_search。然后，在下一次心跳后，我将分析搜索结果并回复用户。因此，整个回合需要一次心跳。"
            },
            "actions": [
                {
                    "function": "web_search",
                    "params": {
                        "inner_thoughts": "这是计划的第一步，纯粹的信息收集。我的计划明确指出需要后续处理，所以顶层心跳应为true。",
                        "query": "large language model recent advancements"
                    }
                }
            ],
            "request_heartbeat": true
        }`;
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "用户'好奇宝宝'询问了关于大型语言模型的最新进展。",
                analyze_infer: "这是一个知识性问题，需要使用外部工具来获取实时信息。",
                plan: "我的计划是：首先，执行web_search。然后，在下一次心跳后，我将分析搜索结果并回复用户。因此，整个回合需要一次心跳。",
            },
            actions: [
                {
                    function: "web_search",
                    params: {
                        inner_thoughts: "这是计划的第一步，纯粹的信息收集。我的计划明确指出需要后续处理，所以顶层心跳应为true。",
                        query: "large language model recent advancements",
                    },
                },
            ],
            request_heartbeat: true,
        });
    });

    it("应该能解析代码块", () => {
        const input = `

\`\`\`json
{
  "thoughts": {
    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"
  },
  "actions": [
    {
      "function": "send_message",
      "params": {
        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
        "message": "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！"
      }
    }
  ],
  "request_heartbeat": false
}
\`\`\`
`;

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
                analyze_infer: "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
                plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
                        message: "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！",
                    },
                },
            ],
            request_heartbeat: false,
        });
    });

    it("应该能解析代码块中嵌套的代码块", () => {
        const message =
            "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！✨<sep/>像这样：\n```javascript\nfunction trimLinesStart(text) {\n  return text.replace(/^\\s+/gm, '');\n}\n\n// 示例\nconst multilineText = `  Hello World!\\n    This is a test.\\n  Another line.`;\nconsole.log(trimLinesStart(multilineText));\n// 输出：\n// Hello World!\n// This is a test.\n// Another line.\n```<sep/>那个`^\\s+`就是匹配每行开头的空格哒！`gm`是多行全局匹配哦~ 是不是很方便呢？(☆ω☆)";
        const input = `


\`\`\`json
{
  "thoughts": {
    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"
  },
  "actions": [
    {
      "function": "send_message",
      "params": {
        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
        "message": ${JSON.stringify(message)}
      }
    }
  ],
  "request_heartbeat": false
}
\`\`\`

        `;

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
                analyze_infer: "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
                plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
                        message: message,
                    },
                },
            ],
            request_heartbeat: false,
        });
    });
});

describe("JsonParser", () => {
    const parser = new JsonParser<ExpectedOutputType>();
    const parserForAny = new JsonParser<any>();

    describe("基本解析", () => {
        it("应该能解析一个完美的、格式化的 JSON 对象", () => {
            const input = `
            {
                "name": "小明",
                "age": 20,
                "isStudent": true,
                "courses": ["Math", "Science"]
            }`;
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小明",
                age: 20,
                isStudent: true,
                courses: ["Math", "Science"],
            });
        });

        it("应该能解析一个完美的 JSON 数组", () => {
            const input = `[{"name": "小明"}, {"name": "小红"}]`;
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual([{ name: "小明" }, { name: "小红" }]);
        });

        it("应该能解析空的 JSON 对象和数组", () => {
            const resultObj = parser.parse("{}");
            expect(resultObj.error).toBeNull();
            expect(resultObj.data).toEqual({});

            const resultArray = parser.parse("[]");
            expect(resultArray.error).toBeNull();
            expect(resultArray.data).toEqual([]);
        });
    });

    describe("处理 LLM 特有的脏数据", () => {
        it("应该能从 Markdown 代码块中提取并解析 JSON", () => {
            const input =
                '当然，这是您要的 JSON 数据：\n```json\n{"name": "小红", "age": 22, "isStudent": false, "courses": []}\n```\n希望对您有帮助！';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小红",
                age: 22,
                isStudent: false,
                courses: [],
            });
            expect(result.logs).toContain("[日志] 从 Markdown 代码块中提取了内容 (使用首尾匹配策略)。");
        });

        it("应该能处理无 `json` 标识的 Markdown 代码块", () => {
            const input = '好的:\n```\n{"name": "小红", "age": 22, "isStudent": false, "courses": []}\n```';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小红",
                age: 22,
                isStudent: false,
                courses: [],
            });
        });

        it("应该能丢弃 JSON 前的多余文本（前言）", () => {
            const input =
                '思考过程：用户需要一个学生信息... 好的，生成JSON。\n{"name": "小刚", "age": 19, "isStudent": true, "courses": ["History"]}';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小刚",
                age: 19,
                isStudent: true,
                courses: ["History"],
            });
            expect(result.logs).toContain("[日志] 在索引 30 处找到 JSON 起始符号，丢弃了前面的文本。");
        });

        it("应该能裁剪掉 JSON 后的多余文本（结语）", () => {
            const input = '{"name": "小明", "age": 20} 这是一些不应该出现的多余解释文本。';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({ name: "小明", age: 20 });
            expect(result.logs).toContainValue("[日志] JSON 结构平衡，裁剪了结束符号之后的多余文本。");
        });

        it("应该能同时处理前言和结语", () => {
            const input = "这是数据：[1, 2, 3] 请查收。";
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual([1, 2, 3]);
            expect(result.logs.some((log) => log.includes("丢弃了前面的文本"))).toBe(true);
            expect(result.logs.some((log) => log.includes("JSON 结构平衡，裁剪了结束符号之后的多余文本。"))).toBe(true);
        });

        it("当 JSON 字符串值中包含 Markdown 代码块时不应错误提取", () => {
            const input = `{
                "name": "代码示例",
                "code": "这是解释文字... \\n\`\`\`js\\nconsole.log(\\"hello\\");\\n\`\`\`\\n 看，这就是代码。"
            }`;
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data.name).toBe("代码示例");
            expect(result.data.code).toContain("```js");
            expect(result.logs).not.toContain("[日志] 从 Markdown 代码块中提取了内容。");
        });
    });

    describe("JSON 语法修复能力 (使用 jsonrepair)", () => {
        it("应该能修复缺失的右大括号", () => {
            const input = '{"name": "小华", "age": 25, "isStudent": true, "courses": ["Art"]';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小华",
                age: 25,
                isStudent: true,
                courses: ["Art"],
            });
        });

        it("应该能修复缺失的右中括号", () => {
            const input = '{"name": "小丽", "age": 21, "isStudent": true, "courses": ["Music", "Dance"';
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小丽",
                age: 21,
                isStudent: true,
                courses: ["Music", "Dance"],
            });
        });

        it("应该能修复多层嵌套的未闭合结构", () => {
            const input = '{"user": {"name": "小强", "details": {"age": 30, "hobbies": ["reading", "coding"';
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                user: {
                    name: "小强",
                    details: {
                        age: 30,
                        hobbies: ["reading", "coding"],
                    },
                },
            });
        });

        it("应该能修复被截断的字符串值", () => {
            const input = '{"name": "小飞", "motto": "永不放弃'; // 字符串未闭合
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小飞",
                motto: "永不放弃",
            });
        });

        it("应该能修复末尾悬垂的键", () => {
            const input = '{"name": "小美", "age": 28, "isStudent": false, "city":'; // 键之后被截断
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            // jsonrepair 会将悬垂的键的值修复为 null
            expect(result.data).toEqual({
                name: "小美",
                age: 28,
                isStudent: false,
                city: null,
            });
        });

        it("应该能处理复杂的混合错误（前言 + Markdown + 截断）", () => {
            const input = '这是输出：\n```json\n{"name": "复杂哥", "data": {"items": ["item1"]}, "status": "incomplete...';
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "复杂哥",
                data: {
                    items: ["item1"],
                },
                status: "incomplete...",
            });
        });
    });

    describe("边界情况和失败用例", () => {
        it("对于完全无法恢复的输入，应该返回解析错误", () => {
            const input = "这是一个完全无关的字符串，没有JSON。";
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).toBe("无法解析为有效的 JSON 对象或数组。");
            expect(result.logs).toContain("[日志] 未找到 JSON 起始符号，将尝试直接修复整个字符串。");
        });

        it("对于只包含 JSON 符号的无关文本，应该返回错误", () => {
            const input = "A { B [ C";
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).not.toBeNull();
        });

        it("对于空的或只包含空白的输入，应该返回错误", () => {
            const resultEmpty = parser.parse("");
            expect(resultEmpty.data).toBeNull();
            expect(resultEmpty.error).not.toBeNull();

            const resultWhitespace = parser.parse("   \n\t ");
            expect(resultWhitespace.data).toBeNull();
            expect(resultWhitespace.error).not.toBeNull();
        });

        it("对于解析结果为字符串的输入，应该判定为失败", () => {
            const input = `"just a string"`; // jsonrepair会修复为 "just a string"
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).toBe("无法解析为有效的 JSON 对象或数组。");
            expect(result.logs.some((log) => log.includes("解析结果为非对象类型，但原始输入不像JSON，判定为解析失败。"))).toBe(true);
        });

        it("对于解析结果为数字的输入，也应该判定为失败", () => {
            const input = `12345`;
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).not.toBeNull();
        });

        it("对于一个不完整的JSON，后缀裁剪步骤不应错误地执行", () => {
            const input = '{"name": "小明", "age": 20, "city": "Beijing"'; // 未闭合
            const result = parser.parse(input);
            expect(result.error).toBeNull(); // jsonrepair会修复它
            expect(result.data).toEqual({
                name: "小明",
                age: 20,
                city: "Beijing",
            });
            // 关键断言：确认没有执行后缀裁剪
            expect(result.logs).not.toContain("[日志] 裁剪了 JSON 结束符号之后的多余文本。");
        });
    });
});
