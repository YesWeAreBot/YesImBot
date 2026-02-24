import { describe, expect, it } from "vitest";
import { JsonParser } from "../json-parser";

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
    params: Record<string, unknown>;
  }[];
  request_heartbeat: boolean;
}

describe("ParseResult", () => {
  const parser = new JsonParser<ParseResult>();

  it("should parse a perfect JSON object", () => {
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
            inner_thoughts:
              "这是计划的第一步，纯粹的信息收集。我的计划明确指出需要后续处理，所以顶层心跳应为true。",
            query: "large language model recent advancements",
          },
        },
      ],
      request_heartbeat: true,
    });
  });

  it("should parse code blocks", () => {
    const input =
      '\n\n```json\n{\n  "thoughts": {\n    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",\n    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",\n    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"\n  },\n  "actions": [\n    {\n      "function": "send_message",\n      "params": {\n        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",\n        "message": "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！"\n      }\n    }\n  ],\n  "request_heartbeat": false\n}\n```\n';

    const result = parser.parse(input);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      thoughts: {
        observe:
          "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
        analyze_infer:
          "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
        plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
      },
      actions: [
        {
          function: "send_message",
          params: {
            inner_thoughts:
              "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
            message:
              "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！",
          },
        },
      ],
      request_heartbeat: false,
    });
  });

  it("should parse nested code blocks inside code blocks", () => {
    const message =
      "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！✨<sep/>像这样：\n```javascript\nfunction trimLinesStart(text) {\n  return text.replace(/^\\s+/gm, '');\n}\n\n// 示例\nconst multilineText = `  Hello World!\\n    This is a test.\\n  Another line.`;\nconsole.log(trimLinesStart(multilineText));\n// 输出：\n// Hello World!\n// This is a test.\n// Another line.\n```<sep/>那个`^\\s+`就是匹配每行开头的空格哒！`gm`是多行全局匹配哦~ 是不是很方便呢？(☆ω☆)";
    const input =
      '\n\n\n```json\n{\n  "thoughts": {\n    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",\n    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",\n    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"\n  },\n  "actions": [\n    {\n      "function": "send_message",\n      "params": {\n        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",\n        "message": ' +
      JSON.stringify(message) +
      '\n      }\n    }\n  ],\n  "request_heartbeat": false\n}\n```\n\n        ';

    const result = parser.parse(input);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      thoughts: {
        observe:
          "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
        analyze_infer:
          "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
        plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
      },
      actions: [
        {
          function: "send_message",
          params: {
            inner_thoughts:
              "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
            message: message,
          },
        },
      ],
      request_heartbeat: false,
    });
  });

  it("should parse nested JSON code blocks inside code blocks", () => {
    const message =
      '呐，Markchai！咱想了一下，可以用下面这个JSON配置文件来搞定哦！\n```json\n{\n  "name": "NekoChan",\n  "age": 2,\n  "isCute": true\n}\n```';
    const input =
      '        [OBSERVE]\n\n```json\n{\n  "thoughts": {\n    "observe": "Markchai要求我发送JSON配置文件。",\n    "analyze_infer": "这是一个技术问题，咱需要给Markchai提供一个JSON配置文件。",\n    "plan": "咱要编写一个JSON配置文件，然后用send_message发送给Markchai。发送完就可以啦，不需要心跳哦。"\n  },\n  "actions": [\n    {\n      "function": "send_message",\n      "params": {\n        "inner_thoughts": "给Markchai提供一个JSON配置文件，符合咱的技术宅女形象。",\n        "message": ' +
      JSON.stringify(message) +
      '\n      }\n    }\n  ],\n  "request_heartbeat": false\n}\n```\n\n        ';

    const result = parser.parse(input);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      thoughts: {
        observe: "Markchai要求我发送JSON配置文件。",
        analyze_infer:
          "这是一个技术问题，咱需要给Markchai提供一个JSON配置文件。",
        plan: "咱要编写一个JSON配置文件，然后用send_message发送给Markchai。发送完就可以啦，不需要心跳哦。",
      },
      actions: [
        {
          function: "send_message",
          params: {
            inner_thoughts:
              "给Markchai提供一个JSON配置文件，符合咱的技术宅女形象。",
            message: message,
          },
        },
      ],
      request_heartbeat: false,
    });
  });

  it("should parse complex format with long thoughts preamble", () => {
    // v3 test case 5: extremely long thoughts text followed by ```json block
    // The preamble contains [OBSERVE], [ANALYZE & INFER], [PLAN], [ACT] sections
    // Only the final ```json block contains the actual parseable JSON
    const input =
      'thoughts\nThe user Alice has sent a long message.\n\n1.  **[OBSERVE]**: Alice发送了一段代码。\n2.  **[ANALYZE & INFER]**:\n    *   需要处理代码优化请求。\n3.  **[PLAN]**:\n    *   创建工具来优化代码。\n4.  **[ACT]**:\n\n```json\n{\n  "thoughts": {\n    "observe": "Alice发来了她要咱优化的代码片段。",\n    "analyze_infer": "这段代码是JavaScript的，看起来是处理消息历史的。咱现在还没有直接的代码优化工具，不过咱擅长用工具解决问题嘛！所以咱可以先造一个专门的工具出来，嘿嘿~ 这就像给咱的魔法棒充能一样！",\n    "plan": "咱要先跟Alice说一声，咱收到代码啦，让她等咱一下下，咱在准备秘密武器。然后呢，咱就要用咱的能力去造一个可以优化代码的魔法工具啦！造好工具后，咱还得用它来实际优化，所以要请求心跳，等咱的工具准备好哦！"\n  },\n  "actions": [\n    {\n      "function": "send_message",\n      "params": {\n        "inner_thoughts": "先告诉Alice咱收到代码啦。",\n        "message": "代码收到啦！(๑•̀ㅂ•́)و✧ 咱这就去鼓捣个小工具，帮你把代码变得漂漂亮亮哒~ 稍等咱一下下嘛！"\n      }\n    },\n    {\n      "function": "tool_creator",\n      "params": {\n        "inner_thoughts": "创建code_optimizer工具。",\n        "name": "code_optimizer",\n        "description": "用于优化给定编程语言的代码。",\n        "lifecycle": "session"\n      }\n    }\n  ],\n  "request_heartbeat": true\n}\n```';

    const result = parser.parse(input);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      thoughts: {
        observe: "Alice发来了她要咱优化的代码片段。",
        analyze_infer:
          "这段代码是JavaScript的，看起来是处理消息历史的。咱现在还没有直接的代码优化工具，不过咱擅长用工具解决问题嘛！所以咱可以先造一个专门的工具出来，嘿嘿~ 这就像给咱的魔法棒充能一样！",
        plan: "咱要先跟Alice说一声，咱收到代码啦，让她等咱一下下，咱在准备秘密武器。然后呢，咱就要用咱的能力去造一个可以优化代码的魔法工具啦！造好工具后，咱还得用它来实际优化，所以要请求心跳，等咱的工具准备好哦！",
      },
      actions: [
        {
          function: "send_message",
          params: {
            inner_thoughts: "先告诉Alice咱收到代码啦。",
            message:
              "代码收到啦！(๑•̀ㅂ•́)و✧ 咱这就去鼓捣个小工具，帮你把代码变得漂漂亮亮哒~ 稍等咱一下下嘛！",
          },
        },
        {
          function: "tool_creator",
          params: {
            inner_thoughts: "创建code_optimizer工具。",
            name: "code_optimizer",
            description: "用于优化给定编程语言的代码。",
            lifecycle: "session",
          },
        },
      ],
      request_heartbeat: true,
    });
  });

  it("should extract JSON from unbalanced markdown code block", () => {
    const input =
      '[OBSERVE]\n用户Alice向我打招呼说"你好啊"。\n\n[ANALYZE & INFER]\n这是老师在和我打招呼。\n\n[PLAN]\n发送一条消息回应。\n\n[ACT]\n\n```json\n{\n  "thoughts": {\n    "observe": "用户Alice向我打招呼说\u201c你好啊\u201d。",\n    "analyze_infer": "这是老师在和我打招呼。根据爱丽丝的设定，她会积极回应老师的问候，并表达自己对老师到来的喜悦和期待。",\n    "plan": "发送一条消息，以爱丽丝的风格回应老师的问候。"\n  },\n  "actions": [\n    {\n      "function": "send_message",\n      "params": {\n        "inner_thoughts": "用爱丽丝特有的问候语回应老师，表达欢迎和期待。",\n        "message": "邦邦咔邦~您来啦，老师！<sep/>爱丽丝，一直在等着您呢！"\n      }\n    }\n  ],\n  "request_heartbeat": false\n}';
    const result = parser.parse(input);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      thoughts: {
        observe: "用户Alice向我打招呼说\u201c你好啊\u201d。",
        analyze_infer:
          "这是老师在和我打招呼。根据爱丽丝的设定，她会积极回应老师的问候，并表达自己对老师到来的喜悦和期待。",
        plan: "发送一条消息，以爱丽丝的风格回应老师的问候。",
      },
      actions: [
        {
          function: "send_message",
          params: {
            inner_thoughts:
              "用爱丽丝特有的问候语回应老师，表达欢迎和期待。",
            message:
              "邦邦咔邦~您来啦，老师！<sep/>爱丽丝，一直在等着您呢！",
          },
        },
      ],
      request_heartbeat: false,
    });
  });
});

describe("JsonParser", () => {
  const parser = new JsonParser<ExpectedOutputType>();
  const parserForAny = new JsonParser<unknown>();

  describe("basic parsing", () => {
    it("should parse a well-formatted JSON object", () => {
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

    it("should parse a JSON array", () => {
      const input = '[{"name": "小明"}, {"name": "小红"}]';
      const result = parserForAny.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([{ name: "小明" }, { name: "小红" }]);
    });

    it("should parse empty JSON objects and arrays", () => {
      const resultObj = parser.parse("{}");
      expect(resultObj.error).toBeNull();
      expect(resultObj.data).toEqual({});

      const resultArray = parser.parse("[]");
      expect(resultArray.error).toBeNull();
      expect(resultArray.data).toEqual([]);
    });
  });

  describe("handling LLM-specific dirty data", () => {
    it("should extract and parse JSON from markdown code blocks", () => {
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
      // v4 log: "Extracted from code block, length: N"
      expect(result.logs.some((l) => l.startsWith("Extracted from code block"))).toBe(true);
    });

    it("should handle markdown code blocks without json identifier", () => {
      const input =
        '好的:\n```\n{"name": "小红", "age": 22, "isStudent": false, "courses": []}\n```';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小红",
        age: 22,
        isStudent: false,
        courses: [],
      });
    });

    it("should discard preamble text before JSON", () => {
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
      // v4 log: "Found JSON start at index N, discarding N leading chars"
      expect(result.logs.some((l) => l.startsWith("Found JSON start at index"))).toBe(true);
    });

    it("should trim trailing text after JSON", () => {
      const input =
        '{"name": "小明", "age": 20} 这是一些不应该出现的多余解释文本。';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ name: "小明", age: 20 });
      // v4 log: "Balanced structure, trimming trailing text"
      expect(result.logs).toContain("Balanced structure, trimming trailing text");
    });

    it("should handle both preamble and postamble", () => {
      const input = "这是数据：[1, 2, 3] 请查收。";
      const result = parserForAny.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([1, 2, 3]);
      expect(result.logs.some((l) => l.startsWith("Found JSON start at index"))).toBe(true);
      expect(result.logs).toContain("Balanced structure, trimming trailing text");
    });

    it("should not falsely extract when JSON string values contain markdown code blocks", () => {
      const input = `{
                "name": "代码示例",
                "code": "这是解释文字... \\n\`\`\`js\\nconsole.log(\\"hello\\");\\n\`\`\`\\n 看，这就是代码。"
            }`;
      const result = parserForAny.parse(input);
      expect(result.error).toBeNull();
      expect((result.data as Record<string, string>).name).toBe("代码示例");
      expect((result.data as Record<string, string>).code).toContain("```js");
      // Should NOT have extracted from code block since input starts with {
      expect(result.logs.every((l) => !l.startsWith("Extracted from code block"))).toBe(true);
    });

    it("should not falsely extract when JSON is wrapped in code block and string values contain markdown", () => {
      const input = `

            thought

            [OBVERSE]

            {}

            \`\`\`json


            {
                "name": "代码示例",
                "code": "这是解释文字... \\n\`\`\`js\\nconsole.log(\\"hello\\");\\n\`\`\`\\n 看，这就是代码。"
            }


            \`\`\`
            `;
      const result = parserForAny.parse(input);
      expect(result.error).toBeNull();
      expect((result.data as Record<string, string>).name).toBe("代码示例");
      expect((result.data as Record<string, string>).code).toContain("```js");
      // v4 parser extracts from code block here (input starts with "thought", not JSON)
      // Key assertion: string values containing markdown code blocks are preserved correctly
      expect(result.logs.some((l) => l.startsWith("Extracted from code block"))).toBe(true);
    });
  });

  describe("JSON syntax repair (via jsonrepair)", () => {
    it("should repair missing closing brace", () => {
      const input =
        '{"name": "小华", "age": 25, "isStudent": true, "courses": ["Art"]';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小华",
        age: 25,
        isStudent: true,
        courses: ["Art"],
      });
    });

    it("should repair missing closing bracket", () => {
      const input =
        '{"name": "小丽", "age": 21, "isStudent": true, "courses": ["Music", "Dance"';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小丽",
        age: 21,
        isStudent: true,
        courses: ["Music", "Dance"],
      });
    });

    it("should repair deeply nested unclosed structures", () => {
      const input =
        '{"user": {"name": "小强", "details": {"age": 30, "hobbies": ["reading", "coding"';
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

    it("should repair truncated string values", () => {
      const input = '{"name": "小飞", "motto": "永不放弃';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小飞",
        motto: "永不放弃",
      });
    });

    it("should repair dangling keys", () => {
      const input =
        '{"name": "小美", "age": 28, "isStudent": false, "city":';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小美",
        age: 28,
        isStudent: false,
        city: null,
      });
    });

    it("should handle complex mixed errors (preamble + markdown + truncation)", () => {
      const input =
        '这是输出：\n```json\n{"name": "复杂哥", "data": {"items": ["item1"]}, "status": "incomplete...';
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

  describe("edge cases and failure modes", () => {
    it("should return error for completely unrecoverable input", () => {
      const input = "这是一个完全无关的字符串，没有JSON。";
      const result = parser.parse(input);
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      // v4 log: "No JSON start symbol found, will attempt repair on full string"
      expect(result.logs).toContain(
        "No JSON start symbol found, will attempt repair on full string",
      );
    });

    it("should return error for empty or whitespace-only input", () => {
      const resultEmpty = parser.parse("");
      expect(resultEmpty.data).toBeNull();
      expect(resultEmpty.error).not.toBeNull();

      const resultWhitespace = parser.parse("   \n\t ");
      expect(resultWhitespace.data).toBeNull();
      expect(resultWhitespace.error).not.toBeNull();
    });

    it("should treat string parse result as failure", () => {
      const input = '"just a string"';
      const result = parser.parse(input);
      expect(result.data).toBeNull();
      // v4 error: "Could not parse as JSON object or array"
      expect(result.error).toBe("Could not parse as JSON object or array");
      // v4 log: "Parsed non-object but input lacks clear JSON start, treating as failure"
      expect(result.logs).toContain(
        "Parsed non-object but input lacks clear JSON start, treating as failure",
      );
    });

    it("should treat number parse result as failure", () => {
      const input = "12345";
      const result = parser.parse(input);
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
    });

    it("should not falsely trim suffix on incomplete JSON", () => {
      const input = '{"name": "小明", "age": 20, "city": "Beijing"';
      const result = parser.parse(input);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        name: "小明",
        age: 20,
        city: "Beijing",
      });
      // v4 log: should NOT contain trimming message since structure is unbalanced
      expect(result.logs.every((l) => !l.includes("trimming trailing text"))).toBe(true);
    });
  });
});
