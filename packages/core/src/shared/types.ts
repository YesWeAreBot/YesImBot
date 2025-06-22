/**
 * 提示构建器配置
 */
export interface PromptBuilderConfig {
    SystemTemplate: string;
    UserTemplate: string;
}

/**
 * 通用配置接口
 */
export interface BaseConfig {
    enabled?: boolean;
    name?: string;
    description?: string;
}

/**
 * 分页参数
 */
export interface PaginationParams {
    page?: number;
    pageSize?: number;
    offset?: number;
    limit?: number;
}

/**
 * 排序参数
 */
export interface SortParams {
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}

/**
 * 查询参数
 */
export interface QueryParams extends PaginationParams, SortParams {
    search?: string;
    filters?: Record<string, any>;
}

/**
 * API响应基础结构
 */
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    timestamp?: Date;
}

/**
 * 分页响应结构
 */
export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
    pagination?: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}
