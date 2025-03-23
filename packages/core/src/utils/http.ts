import axios, { AxiosError, AxiosResponse } from "axios";

import { isNotEmpty } from "./string";
import logger from "./logger";

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

export async function sendRequest<T = any>(
  url: string,
  APIKey: string,
  requestBody: any,
  timeout: number = 114514,
  debug: boolean = false
): Promise<T> {
  try {
    if (debug) {
      logger.info(`
        Request Body:
        ${JSON.stringify(requestBody, null, 2)}
      `);
    }
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': isNotEmpty(APIKey) ? `Bearer ${APIKey}` : undefined,
        'Content-Type': "application/json",
      },
      timeout,
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

    if (debug) {
      logger.info(`
        Response:
        ${JSON.stringify(response.data, null, 2)}
      `);
    }

    return response.data;
  } catch (error) {
    handleError(error, url);
  }
}

export async function sendStreamRequest<T = any>(
  url: string,
  apiKey: string,
  requestBody: any,
  timeout: number = 114514,
  onData: (chunk: string) => void,
  debug: boolean = false
): Promise<T> {
  try {
    // if (debug) {
    //   logger.info(`[Stream Request] URL: ${url}\nBody: ${JSON.stringify(requestBody, null, 2)}`);
    // }
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': isNotEmpty(apiKey) ? `Bearer ${apiKey}` : undefined,
        'Content-Type': "application/json",
        'Accept': 'text/event-stream',
      },
      responseType: 'stream',
      timeout,
    });
    return createStreamProcessor(response, onData);
  } catch (error) {
    handleError(error, url);
  }
}

function createStreamProcessor<T>(response: AxiosResponse, onData: (chunk: string) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const stream = response.data;

    const handleData = (chunk: Buffer) => {
      try {
        buffer += chunk.toString();
        const { remaining, lines } = processSSE(buffer);
        buffer = remaining;

        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data !== '[DONE]') onData(data);
          }
        });
      } catch (e) {
        reject(new HttpError(HttpErrorCode.ServerError, '流数据处理失败', undefined, { chunk }));
      }
    };

    const handleEnd = () => {
      try {
        resolve(buffer as T);
      } catch (e) {
        reject(new HttpError(HttpErrorCode.ServerError, '最终响应解析失败', undefined, { buffer }));
      }
    };

    const handleError = (err: Error) => {
      reject(new HttpError(HttpErrorCode.NetworkError, `流传输错误: ${err.message}`, undefined, { error: err }));
    };

    stream
      .on('data', handleData)
      .on('end', handleEnd)
      .on('error', handleError);
  });
}

function processSSE(buffer: string): { remaining: string; lines: string[] } {
  const lines = buffer.split('\n');
  return {
    remaining: lines.pop() || '',
    lines: lines.filter(line => line.trim().length > 0)
  };
}

function handleError(error: any, url: string) {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data;

      let errorCode = HttpErrorCode.ServerError;
      let message = `API 请求失败(${status})`;

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
