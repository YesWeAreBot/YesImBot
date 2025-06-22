import { Schema } from "koishi";
import { PromptBuilderConfig, BaseConfig, PaginationParams, SortParams, QueryParams } from "./types";

export const PromptBuilderConfigSchema: Schema<PromptBuilderConfig> = Schema.object({
    SystemTemplate: Schema.string().required().description("系统提示模板"),
    UserTemplate: Schema.string().required().description("用户提示模板"),
}).description("提示构建器配置");

export const BaseConfigSchema: Schema<BaseConfig> = Schema.object({
    enabled: Schema.boolean().default(true).description("是否启用"),
    name: Schema.string().description("名称"),
    description: Schema.string().description("描述"),
}).description("基础配置");

export const PaginationParamsSchema: Schema<PaginationParams> = Schema.object({
    page: Schema.number().min(1).default(1).description("页码"),
    pageSize: Schema.number().min(1).max(100).default(20).description("每页大小"),
    offset: Schema.number().min(0).description("偏移量"),
    limit: Schema.number().min(1).max(1000).description("限制数量"),
}).description("分页参数");

export const SortParamsSchema: Schema<SortParams> = Schema.object({
    sortBy: Schema.string().description("排序字段"),
    sortOrder: Schema.union(["asc", "desc"]).default("asc").description("排序顺序"),
}).description("排序参数");

export const QueryParamsSchema: Schema<QueryParams> = Schema.intersect([
    PaginationParamsSchema,
    SortParamsSchema,
    Schema.object({
        search: Schema.string().description("搜索关键词"),
        filters: Schema.dict(Schema.any()).description("过滤条件"),
    }),
]).description("查询参数");
