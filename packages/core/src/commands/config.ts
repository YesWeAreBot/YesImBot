import { Context, isEmpty } from "koishi";
import { Config } from "../config";

export const name = "yesimbot.command.config";

export function apply(ctx: Context, config: Config) {
    ctx.command("conf.get [key:string]", { authority: 3 }).action(async ({ session, options }, key) => {
        if (isEmpty(key)) return "请输入有效的配置键";
        let parsedKeyChain: (string | number)[];
        try {
            parsedKeyChain = parseKeyChain(key);
        } catch (e) {
            return (e as Error).message;
        }

        const data = get(config, parsedKeyChain);

        return JSON.stringify(data, null, 2) || "未找到配置";

        function get(data: any, keys: (string | number)[]) {
            if (keys.length === 0) return data;

            // 递归情况：处理键链
            const currentKey = keys[0]; // 当前处理的键或索引
            const restKeys = keys.slice(1); // 剩余的键链
            const nextKeyIsIndex = typeof restKeys[0] === "number"; // 检查下一个键是否为数字索引

            return get(data[currentKey], restKeys);
        }
    });

    ctx.command("conf.set [key:string] [value:string]", { authority: 3 }).action(async ({ session, options }, key, value) => {
        if (isEmpty(key)) return "请输入有效的配置键";
        if (isEmpty(value)) return "请输入有效的值";

        // 新增：解析键链，支持数组索引
        let parsedKeyChain: (string | number)[];
        try {
            parsedKeyChain = parseKeyChain(key);
        } catch (e) {
            return (e as Error).message;
        }

        try {
            // 确保 top-level config 是一个对象，以便可以添加属性
            // 如果 config 是 null 或 primitive，需要将其初始化为对象
            let mutableConfig: any = config;
            if (typeof mutableConfig !== "object" || mutableConfig === null) {
                mutableConfig = {};
            }

            // 调用更新后的 set 函数
            const data = set(mutableConfig, parsedKeyChain, value);
            ctx.scope.update(data, false);
            config = data; // 更新全局 config 变量
            return "设置成功";
        } catch (e) {
            // 恢复原来的配置
            ctx.scope.update(config, false); // 确保作用域恢复到原始配置
            ctx.logger.error(e);
            return (e as Error).message;
        }

        /**
         * 递归地设置配置项，支持深层嵌套的对象和数组。
         * 使用不可变更新模式，返回新的配置对象。
         *
         * @param currentData 当前层级的配置对象或数组。
         * @param keyChain 剩余的键路径。
         * @param value 要设置的原始字符串值。
         * @returns 更新后的新配置对象或值。
         */
        function set(currentData: any, keyChain: Array<string | number>, value: any): any {
            // 基本情况：键路径已为空，表示已到达目标位置，直接设置值
            if (keyChain.length === 0) {
                return tryParse(value); // 使用 tryParse 智能转换最终值
            }
            const currentKey = keyChain.shift()!; // 取出当前层级的键或索引
            // 判断下一个键是数组索引还是对象键，以便决定如何初始化
            const nextKeyIsIndex = typeof keyChain[0] === "number";
            // 如果当前层级的数据是 null 或 undefined，或者类型不匹配，就初始化它
            let nextSegment = currentData ? currentData[currentKey] : undefined;
            if (nextSegment === undefined || nextSegment === null) {
                // 如果下一个键是数字，初始化为数组；否则初始化为对象。
                nextSegment = nextKeyIsIndex ? [] : {};
            } else if (nextKeyIsIndex && !Array.isArray(nextSegment)) {
                // 类型不匹配：期望数组，但现有不是数组，强制转换为数组
                console.warn(`Path segment "${currentKey}" was not an array, converting to array.`);
                nextSegment = [];
            } else if (!nextKeyIsIndex && (typeof nextSegment !== "object" || Array.isArray(nextSegment))) {
                // 类型不匹配：期望对象，但现有不是对象或却是数组，强制转换为对象
                console.warn(`Path segment "${currentKey}" was not an object, converting to object.`);
                nextSegment = {};
            }
            // 如果当前键是数字（数组索引），且当前数据是数组
            if (typeof currentKey === "number" && Array.isArray(currentData)) {
                // 确保数组有足够的长度来容纳指定索引。不足的部分填充 null。
                // 这确保了像 `arr[5]` 这种直接索引的设置也能正常工作。
                while (currentData.length <= currentKey) {
                    currentData.push(null); // 或者 undefined
                }
                // 创建数组的拷贝以实现不可变更新
                const newArray = [...currentData];
                newArray[currentKey] = set(nextSegment, keyChain, value);
                return newArray;
            } else {
                // 如果当前键是字符串（对象键），且当前数据是对象
                // 创建对象的拷贝以实现不可变更新
                const newObject = { ...currentData };
                newObject[currentKey] = set(nextSegment, keyChain, value);
                return newObject;
            }
        }
    });
}

function toBoolean(value: any): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const lowerValue = value.toLowerCase().trim();
        if (lowerValue === "true") return true;
        if (lowerValue === "false") return false;
    }
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    // 对于其他情况，使用 JavaScript 的隐式转换规则
    return Boolean(value);
}

function hasCommonKeys(obj1, obj2) {
    // 如果 obj1 是空对象，我们将其视为可以合并，因为它不应该阻止任何新属性的添加
    // 否则，只有当两者有共同键时才被视为可以合并
    if (Object.keys(obj1).length === 0) return true;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    return keys1.some((key) => keys2.includes(key));
}

/**
 * 解析键字符串，支持点分隔和方括号索引格式。
 * 例如 "a.b[0].c" => ["a", "b", 0, "c"]
 * @param keyString 原始键字符串
 * @returns (string | number)[] 包含字符串键和数字索引的数组
 */
function parseKeyChain(keyString: string): (string | number)[] {
    const parts: (string | number)[] = [];
    // 使用正则表达式匹配 "key" 或 "key[index]" 模式
    // 分割字符串，允许点分隔或方括号分隔
    // 考虑 "root.items[0].name" 这样的情况
    // 简化处理：先按点分割，再处理方括号
    keyString.split(".").forEach((segment) => {
        const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            // 匹配到如 'items[0]'
            parts.push(arrayMatch[1]); // 键名 'items'
            parts.push(parseInt(arrayMatch[2], 10)); // 索引 0
        } else {
            // 匹配普通键如 'name'
            parts.push(segment);
        }
    });
    // 验证解析结果，防止空字符串或不符合规范的键
    if (parts.some((p) => typeof p === "string" && p.trim() === "")) {
        throw new Error("配置键包含无效的空片段");
    }
    if (parts.length === 0) {
        throw new Error("无法解析配置键");
    }
    return parts;
}

/**
 * 智能地尝试将字符串转换为最合适的原始类型或JSON对象/数组。
 */
function tryParse(value: string): any {
    // 1. 尝试解析为布尔值
    const lowerValue = value.toLowerCase().trim();
    if (lowerValue === "true") return true;
    if (lowerValue === "false") return false;
    // 2. 尝试解析为数字 (但排除仅包含空格或空字符串)
    // 使用 parseFloat 确保能处理小数，同时 Number() 检查 NaN 来排除非数字字符串
    if (!isNaN(Number(value)) && !isNaN(parseFloat(value))) {
        return Number(value);
    }
    // 3. 尝试解析为JSON (对象或数组)
    try {
        const parsedJSON = JSON.parse(value);
        // 确保解析出来的确实是对象或数组，而不是JSON字符串代表的原始值
        // 例如 '123' 会被 JSON.parse 解析为数字 123，但我们已经在前面处理了数字
        // 所以这里只关心真正的对象或数组
        if ((typeof parsedJSON === "object" && parsedJSON !== null) || Array.isArray(parsedJSON)) {
            return parsedJSON;
        }
    } catch (e) {
        // 解析失败，不是有效的JSON
    }
    // 4. Fallback: 如果都不是，则认为是普通字符串
    return value;
}
