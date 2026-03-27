import type { JSONSchema4 } from "json-schema";
import { Schema } from "koishi";

/**
 * 将 Koishi Schema 转换为 JSONSchema4
 */
export function schemaToJSONSchema(schema: Schema): JSONSchema4 {
  if (!schema) return {};

  const type = schema.type as string;

  // 基本元数据
  const meta: JSONSchema4 = {};
  if (schema.meta?.description) {
    // description 可能是字符串或多语言字典
    const desc = schema.meta.description;
    meta.description = typeof desc === "string" ? desc : undefined;
  }
  if (schema.meta?.default !== undefined) {
    meta.default = schema.meta.default;
  }

  switch (type) {
    case "object": {
      const properties: Record<string, JSONSchema4> = {};
      const required: string[] = [];
      const dict = schema.dict as Record<string, Schema> | undefined;

      for (const [key, child] of Object.entries(dict ?? {})) {
        properties[key] = schemaToJSONSchema(child);
        if (child.meta?.required) {
          required.push(key);
        }
      }

      const result: JSONSchema4 = {
        type: "object",
        properties,
        ...meta,
      };

      if (required.length > 0) {
        result.required = required;
      }

      return result;
    }

    case "array": {
      const result: JSONSchema4 = {
        type: "array",
        items: schema.inner ? schemaToJSONSchema(schema.inner as Schema) : {},
        ...meta,
      };
      return result;
    }

    case "dict": {
      // dict 在 JSONSchema 中可以表示为 Record<string, ValueType>
      // 或者使用 additionalProperties
      const result: JSONSchema4 = {
        type: "object",
        additionalProperties: schema.inner ? schemaToJSONSchema(schema.inner as Schema) : true,
        ...meta,
      };
      return result;
    }

    case "const": {
      const result: JSONSchema4 = {
        const: schema.value,
        ...meta,
      };
      return result;
    }

    case "union": {
      const list = schema.list ?? [];

      // 检查是否是简单的枚举值（所有子项都是 const 且有值）
      const values = list.map((s) => (s as Schema).value);
      const allConst = values.every((v) => v !== undefined);

      if (allConst) {
        // 简单枚举，使用 enum
        return {
          enum: values,
          ...meta,
        };
      }

      // 复杂联合类型，使用 oneOf
      return {
        oneOf: list.map((s) => schemaToJSONSchema(s as Schema)),
        ...meta,
      };
    }

    case "intersect": {
      // intersect 使用 allOf
      return {
        allOf: (schema.list ?? []).map((s) => schemaToJSONSchema(s as Schema)),
        ...meta,
      };
    }

    case "string": {
      const result: JSONSchema4 = {
        type: "string",
        ...meta,
      };

      // 处理 pattern
      if (schema.meta?.pattern) {
        result.pattern = schema.meta.pattern.source;
        if (schema.meta.pattern.flags) {
          result.pattern += `/${schema.meta.pattern.flags}`;
        }
      }

      // minLength/maxLength - Schema 中没有直接等价，但可以通过 extra 扩展
      // 这里暂不处理，因为需要检查 schema.extra

      return result;
    }

    case "number":
    case "natural":
    case "percent": {
      const result: JSONSchema4 = {
        type: "number",
        ...meta,
      };

      if (schema.meta?.min !== undefined) {
        result.minimum = schema.meta.min;
      }
      if (schema.meta?.max !== undefined) {
        result.maximum = schema.meta.max;
      }
      if (schema.meta?.step !== undefined) {
        result.multipleOf = schema.meta.step;
      }

      return result;
    }

    case "boolean": {
      return {
        type: "boolean",
        ...meta,
      };
    }

    case "date": {
      return {
        type: "string",
        format: "date-time",
        ...meta,
      };
    }

    case "bitset": {
      // bitset 转换为整数或字符串数组的联合类型
      const bits = schema.bits ?? {};
      return {
        oneOf: [
          { type: "number" },
          { type: "array", items: { type: "string", enum: Object.keys(bits) } },
        ],
        ...meta,
      };
    }

    case "any":
    default: {
      // any 类型不指定 type，允许任何值
      return meta;
    }
  }
}

/**
 * 将 JSONSchema4 转换为 Koishi Schema
 */
export function jsonSchemaToSchema(jsonSchema: JSONSchema4): Schema {
  // 1. 处理常量 const
  if ("const" in jsonSchema && jsonSchema.const !== undefined) {
    // Schema.const 只接受 string | number | boolean，处理 null 的情况
    let schema: Schema;
    if (jsonSchema.const === null) {
      schema = Schema.any(); // null 没有直接等价，用 any 代替
    } else {
      schema = Schema.const(jsonSchema.const as string | number | boolean);
    }
    if (jsonSchema.description) {
      schema = schema.description(jsonSchema.description);
    }
    return schema;
  }

  // 2. 处理枚举 enum
  if (jsonSchema.enum) {
    // 检查是否只包含原始类型
    const isPrimitive = jsonSchema.enum.every(
      (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );

    let schema: Schema;
    if (isPrimitive) {
      schema = Schema.union(jsonSchema.enum as (string | number | boolean | null)[]);
    } else {
      // 对于复杂类型的枚举，使用 oneOf 处理
      return jsonSchemaToSchema({
        ...jsonSchema,
        enum: undefined,
        oneOf: jsonSchema.enum.map((v) => ({ const: v })),
      } as JSONSchema4);
    }

    if (jsonSchema.description) {
      schema = schema.description(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default as Parameters<typeof schema.default>[0]);
    }
    return schema;
  }

  // 3. 处理组合类型 oneOf, allOf, anyOf
  if (jsonSchema.oneOf) {
    // 尝试检测是否是简单的枚举
    const schemas = jsonSchema.oneOf.map((s) => jsonSchemaToSchema(s));
    const values = schemas.map((s) => (s.type === "const" ? s.value : undefined));
    const allConst = values.every((v) => v !== undefined);

    let schema: Schema;
    if (allConst) {
      // 简单枚举
      schema = Schema.union(values as NonNullable<typeof values>[]);
    } else {
      // 复杂联合类型
      schema = Schema.union(schemas);
    }

    if (jsonSchema.description) {
      schema = schema.description(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }

  if (jsonSchema.allOf) {
    let schema = Schema.intersect(jsonSchema.allOf.map((s) => jsonSchemaToSchema(s)));
    if (jsonSchema.description) {
      schema = schema.description(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }

  if (jsonSchema.anyOf) {
    // anyOf 类似 oneOf，但允许匹配多个
    let schema = Schema.union(jsonSchema.anyOf.map((s) => jsonSchemaToSchema(s)));
    if (jsonSchema.description) {
      schema = schema.description(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }

  // 4. 根据 type 处理基本类型
  const type = jsonSchema.type;
  let schema: Schema;

  // 类型可能是字符串或数组
  const typeArray = Array.isArray(type) ? type : type ? [type] : [];

  switch (typeArray[0] as string) {
    case "string": {
      schema = Schema.string();

      // 处理 pattern
      if (jsonSchema.pattern) {
        try {
          const patternRegex = parsePatternString(jsonSchema.pattern);
          schema = schema.pattern(patternRegex);
        } catch {
          // pattern 格式错误，忽略
        }
      }

      // minLength/maxLength - Schema 没有直接等价，可以通过 extra 存储
      // 或者作为注释添加
      if (jsonSchema.minLength !== undefined || jsonSchema.maxLength !== undefined) {
        const constraints: string[] = [];
        if (jsonSchema.minLength !== undefined) {
          constraints.push(`min: ${jsonSchema.minLength}`);
        }
        if (jsonSchema.maxLength !== undefined) {
          constraints.push(`max: ${jsonSchema.maxLength}`);
        }
        if (constraints.length > 0) {
          schema = schema.comment(`Length constraints: ${constraints.join(", ")}`);
        }
      }

      // 处理 format
      if (jsonSchema.format === "date-time" || jsonSchema.format === "date") {
        schema = Schema.date();
      }

      break;
    }

    case "number":
    case "integer": {
      schema = Schema.number();

      if (jsonSchema.minimum !== undefined) {
        schema = schema.min(jsonSchema.minimum);
      }
      if (jsonSchema.maximum !== undefined) {
        schema = schema.max(jsonSchema.maximum);
      }
      if (jsonSchema.multipleOf !== undefined) {
        schema = schema.step(jsonSchema.multipleOf);
      }

      // integer 类型可以添加注释
      if (type === "integer") {
        schema = schema.comment("Must be an integer");
      }

      break;
    }

    case "boolean": {
      schema = Schema.boolean();
      break;
    }

    case "array": {
      const itemsSchema = jsonSchema.items ? jsonSchemaToSchema(jsonSchema.items) : Schema.any();
      schema = Schema.array(itemsSchema);

      // minItems/maxItems/uniqueItems - 通过 extra 存储或注释
      const constraints: string[] = [];
      if (jsonSchema.minItems !== undefined) {
        constraints.push(`min: ${jsonSchema.minItems}`);
      }
      if (jsonSchema.maxItems !== undefined) {
        constraints.push(`max: ${jsonSchema.maxItems}`);
      }
      if (jsonSchema.uniqueItems) {
        constraints.push("unique");
      }
      if (constraints.length > 0) {
        schema = schema.comment(`Array constraints: ${constraints.join(", ")}`);
      }

      break;
    }

    case "object": {
      const properties = jsonSchema.properties || {};
      // required 可能是 boolean | string[] | undefined
      const required = jsonSchema.required;
      const requiredFields = new Set(Array.isArray(required) ? required : []);
      const schemasteryProperties: Record<string, Schema> = {};

      for (const key in properties) {
        let propSchema = jsonSchemaToSchema(properties[key]);
        if (requiredFields.has(key)) {
          propSchema = propSchema.required();
        }
        schemasteryProperties[key] = propSchema;
      }

      schema = Schema.object(schemasteryProperties);

      // 处理 additionalProperties - 类似 dict
      // 注意: Koishi Schema.object 不支持 additionalProperties，
      // 如果需要动态键值对，应使用 Schema.dict
      break;
    }

    case "null": {
      schema = Schema.const(null);
      break;
    }

    default: {
      // 未指定类型或 any
      schema = Schema.any();
      break;
    }
  }

  // 5. 应用通用修饰器
  if (jsonSchema.description) {
    schema = schema.description(jsonSchema.description);
  }

  if (jsonSchema.title) {
    // title 也可以作为 description
    if (!jsonSchema.description) {
      schema = schema.description(jsonSchema.title);
    }
  }

  if (jsonSchema.default !== undefined) {
    schema = schema.default(jsonSchema.default);
  }

  return schema;
}

/**
 * 解析 pattern 字符串（可能是 "source/flags" 格式）
 */
function parsePatternString(pattern: string): RegExp {
  const match = pattern.match(/^\/(.+)\/([gimuy]*)$/);
  if (match) {
    return new RegExp(match[1], match[2]);
  }
  // 尝试直接作为正则表达式
  return new RegExp(pattern);
}
