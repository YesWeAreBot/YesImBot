import type { QueryValidation } from "../types.js";

const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;
const MAX_QUERY_LENGTH = 200;

interface ValidateOptions {
  query: string;
  where: "here" | "all";
  hasUserFilter?: boolean;
  hasTimeFilter?: boolean;
}

export function validateQuery(options: ValidateOptions): QueryValidation {
  const { query, where, hasUserFilter, hasTimeFilter } = options;

  // 允许无 query 但有时间过滤
  if (!query && hasTimeFilter) {
    return { valid: true, normalized: "" };
  }

  // 允许无 query 但有过滤条件（user）
  if (!query && hasUserFilter) {
    return { valid: true, normalized: "" };
  }

  const trimmed = (query ?? "").trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return { valid: false, hint: "请提供搜索关键词或时间范围（since/until）。" };
  }

  if (trimmed.length === 1) {
    return { valid: false, hint: "请提供更具体的关键词，单字符查询范围过广。" };
  }

  if (PUNCTUATION_ONLY.test(trimmed)) {
    return { valid: false, hint: "请提供有意义的关键词，纯标点无法有效搜索。" };
  }

  if (where === "all" && !hasUserFilter && !hasTimeFilter) {
    return {
      valid: false,
      hint: "跨频道搜索需要至少一个过滤条件（用户或时间范围），请添加 user、since 或 until 参数。",
    };
  }

  const normalized = trimmed.toLowerCase().slice(0, MAX_QUERY_LENGTH);

  return { valid: true, normalized };
}
