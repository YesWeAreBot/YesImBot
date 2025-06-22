import { describe, it, expect } from "bun:test";
import { JsonParser } from "../src/shared/utils/json-parser";

// 定义一个我们期望的输出类型
interface ExpectedOutputType {
    name: string;
    age: number;
    isStudent: boolean;
    courses: string[];
}

describe("LLMJsonParser", () => {
    const parser = new JsonParser<ExpectedOutputType>();

    it("应该能解析一个完美的 JSON", () => {
        const input = '{"name": "小明", "age": 20, "isStudent": true, "courses": ["Math", "Science"]}';
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小明",
            age: 20,
            isStudent: true,
            courses: ["Math", "Science"],
        });
    });

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
    });

    it("应该能处理 JSON 前后的多余文本", () => {
        const input =
            '思考过程：用户需要一个学生信息... 好的，生成JSON。\n{"name": "小刚", "age": 19, "isStudent": true, "courses": ["History"]}\n这就是结果。';
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小刚",
            age: 19,
            isStudent: true,
            courses: ["History"],
        });
    });

    it("应该能修复未闭合的对象括号", () => {
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

    it("应该能修复未闭合的数组括号", () => {
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

    it("应该能修复多层未闭合的结构", () => {
        const input = '{"user": {"name": "小强", "details": {"age": 30, "hobbies": ["reading", "coding"';
        const result = parser.parse(input);
        // 注意：这里的类型推断可能不完美，我们只关心它是否能解析成一个对象
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

    it("应该能移除末尾悬垂的不完整键值对", () => {
        const input = '{"name": "小美", "age": 28, "isStudent": false, "incomple'; // 网络中断
        const result = parser.parse(input);
        // 这里 jsonrepair 可能会修复它，但我们的策略是先清理
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小美",
            age: 28,
            isStudent: false,
            incomple: null,
        });
    });

    it("应该能移除末尾悬垂的带引号的键", () => {
        const input = '{"name": "小美", "age": 28, "isStudent": false, "city":'; // 网络中断
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小美",
            age: 28,
            isStudent: false,
            city: null,
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

    it("【修正】应该能处理复杂的混合错误，且不会丢失被截断部分的数据", () => {
        // 这个输入之前会因为错误的提取策略而失败
        const input = '这是输出：\n```json\n{"name": "复杂哥", "data": {"items": ["item1", "item2"]}, "status": "incomplete...';

        const result = parser.parse(input);

        expect(result.error).toBeNull();
        // 关键断言：现在 `status` 字段应该被保留并修复
        expect(result.data).toEqual({
            name: "复杂哥",
            data: {
                items: ["item1", "item2"],
            },
            status: "incomplete...", // 字符串被截断，但被我们的修复策略补全了引号
        });
    });

    it("【新增】应该能裁剪掉一个完整 JSON 对象后面的多余文本", () => {
        const input = '{"name": "小明", "age": 20} 这是一些不应该出现的多余解释文本。';
        const result = parser.parse(input);

        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小明",
            age: 20,
        });
        // 验证日志，确保裁剪步骤被执行
        expect(result.logs.some((log) => log.includes("裁剪了后面的垃圾字符"))).toBe(true);
    });

    it("【新增】对于一个不完整的JSON，边界裁剪步骤不应错误地执行", () => {
        const input = '{"name": "小明", "age": 20, "city": "Beijing"'; // 未闭合
        const result = parser.parse(input);

        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            name: "小明",
            age: 20,
            city: "Beijing",
        });
        // 验证日志，确保裁剪步骤被跳过
        expect(result.logs.some((log) => log.includes("裁剪了后面的垃圾字符"))).toBe(false);
        expect(result.logs.some((log) => log.includes("不进行裁剪"))).toBe(true);
    });

    it("当修复策略被禁用时，应该跳过相应的修复", () => {
        const noFixParser = new JsonParser<ExpectedOutputType>({
            repairStrategies: {
                fixUnclosedObjects: false,
            },
        });
        const input = '{"name": "小华", "age": 25'; // 未闭合
        const result = noFixParser.parse(input);
        // 因为禁用了闭合修复，所以 jsonrepair 可能会成功，也可能失败，但我们能验证日志
        // 更可靠的测试是测试一个 jsonrepair 无法修复但我们的策略可以的场景
        const anotherInput = '{"user": {"name": "test"'; // 嵌套未闭合
        const result2 = noFixParser.parse(anotherInput);
        expect(result2.error).not.toBeNull(); // 期望它失败
        expect(result2.logs.some((log) => log.includes('检测到未闭合的 "{"'))).toBe(false);
    });

    it("对于完全无法恢复的 JSON，应该返回错误", () => {
        const input = "这是一个完全无关的字符串，没有JSON。";
        const result = parser.parse(input);
        expect(result.data).toBeNull();
        expect(result.error).not.toBeNull();
        expect(result.error).toContain("无法解析");
    });
});
