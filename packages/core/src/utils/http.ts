import axios, { AxiosError } from "axios";

import { foldText, isNotEmpty } from "./string";

export enum HttpErrorCode {
  NetworkError = 'NETWORK_ERROR',
  Timeout = 'TIMEOUT',
  BadRequest = 'BAD_REQUEST',
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  ServerError = 'SERVER_ERROR',
  UnknownError = 'UNKNOWN_ERROR'
}

export class HttpError extends Error {
  public readonly code: HttpErrorCode;
  public readonly status?: number;
  public readonly details?: Record<string, any>;

  constructor(code: HttpErrorCode, message: string, status?: number, details?: Record<string, any>) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError;
  }
}

export async function sendRequest<T = any>(url: string, APIKey: string, requestBody: any, debug: boolean = false): Promise<T> {
    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': isNotEmpty(APIKey) ? `Bearer ${APIKey}` : undefined,
          'Content-Type': "application/json",
        },
        timeout: 114514,
      });

      if (response.status !== 200) {
        const errorMessage = JSON.stringify(response.data);
        throw new HttpError(
          HttpErrorCode.ServerError,
          `请求失败: ${response.status} - ${errorMessage}`,
          response.status,
          response.data
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response) {
          const status = axiosError.response.status;
          const data = axiosError.response.data;

          let errorCode = HttpErrorCode.ServerError;
          let message = `API 请求失败: ${status}`;

          switch (status) {
            case 400:
              errorCode = HttpErrorCode.BadRequest;
              message = `400 - 请求参数错误: ${JSON.stringify(data)}`;
              break;
            case 401:
              errorCode = HttpErrorCode.Unauthorized;
              message = `401 - 认证失败，请检查API Key`;
              break;
            case 403:
              errorCode = HttpErrorCode.Forbidden;
              message = `403 - 权限不足: ${JSON.stringify(data)}`;
              break;
            case 404:
              errorCode = HttpErrorCode.NotFound;
              message = `404 - 资源未找到: ${url}`;
              break;
            case 429:
              errorCode = HttpErrorCode.ServerError;
              message = `429 - 请求过于频繁，请稍后重试`;
              break;
            case 500:
              errorCode = HttpErrorCode.ServerError;
              message = `500 - 服务器内部错误: ${JSON.stringify(data)}`;
              break;
          }

          throw new HttpError(errorCode, message, status, data);
        } else if (axiosError.request) {
          throw new HttpError(
            HttpErrorCode.NetworkError,
            `网络连接失败: ${axiosError.message}`,
            undefined,
            { url }
          );
        } else {
          throw new HttpError(
            HttpErrorCode.UnknownError,
            `未知错误: ${axiosError.message}`,
            undefined,
            { url }
          );
        }
      }

      if (error instanceof Error) {
        throw new HttpError(
          HttpErrorCode.UnknownError,
          `未知错误: ${error.message}`,
          undefined,
          { url }
        );
      }

      throw new HttpError(
        HttpErrorCode.UnknownError,
        `未知错误`,
        undefined,
        { url }
      );
    }
  }
