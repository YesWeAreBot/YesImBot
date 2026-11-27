import type { Param, Properties } from "./types";

/** One view for command help and agent templates; never mutates schemas. */
export function processParams(params: Properties, indent = ""): any[] {
    const convert = (key: string, param: Param, level: string): any => ({
        ...param,
        key,
        indent: level,
        ...(param.properties ? { properties: processParams(param.properties, level + "    ") } : {}),
        ...(param.items ? { items: [convert("item", param.items, level + "    ")] } : {}),
    });
    return Object.entries(params).map(([key, param]) => convert(key, param, indent));
}
