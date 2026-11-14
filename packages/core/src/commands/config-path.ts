import { Schema, type Context } from "koishi";

import { Config } from "../config";
import { sanitizeDiagnostic } from "../shared/diagnostic-sanitizer";

type Key = string | number;
type Node = { schemas: Schema[]; value: unknown };
const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);
const modelReference = Schema.object({ providerName: Schema.string().required(), modelId: Schema.string().required() });
const dynamicFallbacks: Record<string, Schema> = {
    "modelService.selectableModels": modelReference,
    "modelService.evaluationModels": modelReference,
    "modelService.availableGroups": Schema.string(),
    "toolService.backgroundEligibleTools": Schema.array(Schema.string()),
};

export class ConfigPathError extends Error {}

export function parseConfigPath(path: string): Key[] {
    if (path.length > 300 || !/^[\w-]+(?:\[\d+\])*(?:\.[\w-]+(?:\[\d+\])*)*$/u.test(path))
        throw new ConfigPathError("配置路径语法错误，请使用 foo.bar 或 foo[0].bar。");
    const keys = Array.from(path.matchAll(/([\w-]+)|\[(\d+)\]/gu), ([, key, index]) => key ?? Number(index));
    if (keys.some((key) => (typeof key === "number" ? !Number.isSafeInteger(key) : blockedKeys.has(key))))
        throw new ConfigPathError("配置路径包含不允许的字段或索引。");
    return keys;
}

export function formatPath(keys: readonly Key[]): string {
    return keys.map((key, index) => (typeof key === "number" ? `[${key}]` : index ? `.${key}` : key)).join("");
}

function own(value: unknown, key: Key): unknown {
    return value !== null && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<Key, unknown>)[key] : undefined;
}

function accepts(schema: Schema, value: unknown): boolean {
    try {
        schema(structuredClone(value));
        return true;
    } catch {
        return false;
    }
}

function parts(ctx: Context, schema: Schema, value: unknown): Schema[] {
    if (schema.meta.role === "dynamic") {
        const name = schema.meta.extra?.name;
        const dynamic = typeof name === "string" ? (dynamicFallbacks[name] ?? ctx.schema?.get(name)) : undefined;
        return dynamic && dynamic !== schema ? parts(ctx, dynamic, value) : [];
    }
    if (schema.type === "intersect") return schema.list!.flatMap((item) => parts(ctx, item, value));
    if (schema.type === "transform") return schema.inner ? parts(ctx, schema.inner, value) : [];
    if (schema.type === "union") {
        // Keep all scalar options for type-aware parsing. For discriminated object
        // unions, prefer the branch matching the current provider/type.
        const candidates = schema.list!.filter(
            (item) => item.type === "object" && Object.entries(item.dict ?? {}).some(([key, field]) => field.type === "const" && own(value, key) !== undefined),
        );
        if (candidates.length) {
            const selected = candidates.find((item) =>
                Object.entries(item.dict ?? {}).every(
                    ([key, field]) => field.type !== "const" || own(value, key) === undefined || own(value, key) === field.value,
                ),
            );
            if (selected) return parts(ctx, selected, value);
        }
        return schema.list!.flatMap((item) => parts(ctx, item, value));
    }
    return [schema];
}

function childSchemas(ctx: Context, node: Node, key: Key): Schema[] {
    return node.schemas
        .flatMap((schema) => parts(ctx, schema, node.value))
        .flatMap((schema) => {
            if (typeof key === "number")
                return schema.type === "array" && schema.inner ? [schema.inner] : schema.type === "tuple" && schema.list?.[key] ? [schema.list[key]] : [];
            if (schema.type === "object" && schema.dict && Object.hasOwn(schema.dict, key)) return [schema.dict[key]];
            if (schema.type === "dict" && schema.inner && (!schema.sKey || accepts(schema.sKey, key))) return [schema.inner];
            return [];
        });
}

export function resolveConfigPath(ctx: Context, config: Config, keys: Key[]): Node {
    let node: Node = { schemas: [Config], value: config };
    for (const [index, key] of keys.entries()) {
        const prefix = formatPath(keys.slice(0, index + 1));
        if (typeof key === "number" && (!Array.isArray(node.value) || !Object.hasOwn(node.value, key)))
            throw new ConfigPathError(`未找到配置：索引超出范围（${prefix}）。请先在配置页或通过完整数组添加项目。`);
        const schemas = childSchemas(ctx, node, key);
        if (!schemas.length || schemas.every((schema) => schema.meta.hidden || schema.meta.disabled))
            throw new ConfigPathError(`未找到配置：未知或不可调整的路径 ${prefix}。`);
        node = { schemas, value: own(node.value, key) };
    }
    return node;
}

function checkObjectKeys(ctx: Context, node: Node, keys: Key[]): void {
    const { value } = node;
    if (!value || typeof value !== "object") return;
    for (const field of Object.keys(value)) {
        const key = Array.isArray(value) ? Number(field) : field;
        const prefix = [...keys, key];
        const path = formatPath(prefix);
        if (blockedKeys.has(field)) throw new ConfigPathError(`配置包含不允许的字段 ${path}。`);
        const schemas = childSchemas(ctx, node, key);
        if (!schemas.length) {
            const opaque = node.schemas.flatMap((schema) => parts(ctx, schema, value)).some((schema) => schema.type === "any" || schema.type === "const");
            if (!opaque) throw new ConfigPathError(`未找到配置：未知字段 ${path}。`);
            // Even opaque payloads must not contain dangerous property names.
            checkObjectKeys(ctx, { schemas: [Schema.any()], value: own(value, key) }, prefix);
            continue;
        }
        checkObjectKeys(ctx, { schemas, value: own(value, key) }, prefix);
    }
}

export function parseConfigValue(ctx: Context, node: Node, input: string, keys: Key[]): unknown {
    const choices = node.schemas.flatMap((schema) => parts(ctx, schema, node.value));
    const kinds = choices.map((schema) => (schema.type === "const" ? typeof schema.value : schema.type));
    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch {
        parsed = input;
    }
    const retainString = kinds.includes("string") && !kinds.includes(typeof parsed) && typeof node.value !== "number" && typeof node.value !== "boolean";
    const value = retainString ? input : parsed;
    checkObjectKeys(ctx, { ...node, value }, keys);
    if (
        value === null ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (choices.length ? !choices.some((schema) => accepts(schema, value)) : !node.schemas.some((schema) => accepts(schema, value)))
    )
        throw new ConfigPathError(`配置值无效：${formatPath(keys)} 需要 ${describeType(ctx, node)}。`);
    return value;
}

export function writeConfigValue(value: unknown, [key, ...rest]: Key[], replacement: unknown): unknown {
    if (key === undefined) return replacement;
    const child = writeConfigValue(own(value, key), rest, replacement);
    if (Array.isArray(value) && typeof key === "number") return value.map((item, index) => (key === index ? child : item));
    return { ...(value as object), [key]: child };
}

function describeType(ctx: Context, node: Node): string {
    const names: Record<string, string> = {
        string: "字符串",
        number: "数字",
        boolean: "true 或 false",
        array: "JSON 数组",
        tuple: "JSON 数组",
        object: "JSON 对象",
        dict: "JSON 对象",
        any: "任意值",
    };
    const choices = node.schemas.flatMap((schema) => parts(ctx, schema, node.value));
    return (
        [
            ...new Set(
                choices.map((schema) =>
                    schema.type === "const" && typeof schema.value !== "object" ? JSON.stringify(schema.value) : (names[schema.type] ?? "JSON"),
                ),
            ),
        ].join(" / ") || "有效配置值"
    );
}

export function listConfigFields(ctx: Context, node: Node, path: Key[]): string[] {
    const fields = new Set<Key>();
    for (const schema of node.schemas.flatMap((schema) => parts(ctx, schema, node.value))) {
        if (schema.type === "object") Object.keys(schema.dict ?? {}).forEach((key) => fields.add(key));
        if (schema.type === "dict") Object.keys(node.value ?? {}).forEach((key) => fields.add(key));
        if ((schema.type === "array" || schema.type === "tuple") && Array.isArray(node.value)) node.value.forEach((_, index) => fields.add(index));
    }
    return [...fields].flatMap((key) => {
        const schemas = childSchemas(ctx, node, key).filter((schema) => !schema.meta.hidden && !schema.meta.disabled);
        if (!schemas.length) return [];
        const child = { schemas, value: own(node.value, key) };
        const description = schemas
            .map((schema) => schema.meta.description)
            .find((value): value is string => typeof value === "string" && Boolean(value))
            ?.replace(/<[^>]+>/g, "")
            .split("\n")[0];
        const status = child.value === undefined ? " · 未设置" : Array.isArray(child.value) ? ` · ${child.value.length} 项` : "";
        return [`${formatPath([...path, key])} · ${describeType(ctx, child)}${status}${description ? ` · ${description}` : ""}`];
    });
}

export function safeConfigValue(ctx: Context, node: Node, path: Key[]): unknown {
    const { value } = node;
    const key = path.at(-1);
    if (
        node.schemas.some((schema) => schema.meta.role === "secret") ||
        (typeof key === "string" && /^(?:api[-_]?key|authorization|cookie|password|secret|token|proxy|base[-_]?url|paste[-_]?service[-_]?url)$/i.test(key))
    )
        return value === undefined ? undefined : "[已隐藏]";
    if (value && typeof value === "object") {
        const entries = Object.keys(value).map((field) => {
            const key = Array.isArray(value) ? Number(field) : field;
            return [key, safeConfigValue(ctx, { schemas: childSchemas(ctx, node, key), value: own(value, key) }, [...path, key])] as const;
        });
        return Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries);
    }
    return sanitizeDiagnostic(value);
}
