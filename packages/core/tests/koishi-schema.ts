import { Schema } from "koishi";

// 1. 优化 Param 接口，使其能更好地描述不同类型的元信息
interface Param {
    type: string;
    description?: string;
    default?: any;
    required?: boolean;
    // 用于 object 类型
    properties?: Properties;
    // 用于 union/enum 类型
    enum?: any[];
    // (可选扩展) 用于 array 类型
    items?: Param;
}

type Properties = Record<string, Param>;

// 示例 Schema 保持不变
export const TestSchema = Schema.object({
    test: Schema.string().required().description("测试参数"),
    test2: Schema.string().default("test2").description("测试参数2"),
    obj: Schema.object({
        a: Schema.string().description("对象参数a"),
        b: Schema.number().required().description("对象参数b"),
    }).description("这是一个嵌套对象"),
    enum: Schema.union([Schema.const("a").description("选项A"), Schema.const("b").description("选项B")]).description("这是一个枚举"),
});

/**
 * 从 Koishi Schema 中提取元信息。
 * @param schema 要解析的 Schema.object 实例
 * @returns 提取出的元信息对象 (Properties)
 */
export function extractMetaFromSchema(schema: Schema): Properties {
    // 2. 确保输入的是一个 object 类型的 schema
    if (schema.type !== "object" || !schema.dict) {
        // console.warn("Input schema is not an object schema.");
        return {};
    }

    // 3. 使用 Object.entries 和 reduce/map 来实现，更函数式和简洁
    return Object.fromEntries(
        Object.entries(schema.dict).map(([key, valueSchema]) => {
            // 4. 为每个属性创建一个基础的元信息对象
            const param: Param = {
                type: valueSchema.type,
                description: valueSchema.meta.description as string,
            };

            // 统一处理通用元信息
            if (valueSchema.meta.required) {
                param.required = true;
            }
            if (valueSchema.meta.default !== undefined) {
                param.default = valueSchema.meta.default;
            }

            // 5. 使用 switch 处理特定类型的逻辑
            switch (valueSchema.type) {
                case "object":
                    // 6. 关键优化：递归调用来处理嵌套对象
                    param.properties = extractMetaFromSchema(valueSchema);
                    break;
                case "union":
                    // 假设 union 用于实现枚举 (enum)
                    if (valueSchema.list?.every((item) => item.type === "const")) {
                        // 可以进一步优化，比如推断 type (string/number)
                        param.type = "string";
                        param.enum = valueSchema.list.map((item) => item.value);
                    }
                    break;
                // 对于 string, number, boolean 等简单类型，基础信息已足够
                case "string":
                case "number":
                case "boolean":
                    break;
                // 可以轻松扩展以支持更多类型，例如 array
                // case 'array':
                //   param.items = extractSingleParam(valueSchema.inner); // 需要一个辅助函数来处理非 object 的 schema
                //   break;
            }

            return [key, param];
        })
    );
}

// --- 使用示例 ---
console.log("原始 Schema.toString():");
console.log(TestSchema.toString());

console.log("\n优化后提取的元信息:");
const properties = extractMetaFromSchema(TestSchema);
console.log(JSON.stringify(properties, null, 2));
