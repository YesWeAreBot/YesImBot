import { Usage } from "../adapters/base";

export interface Tool extends Function {
  name: string;
  params: Record<string, any>;
}

export interface SuccessResponse {
  status: "success";
  raw: string;
  finalReply: string;
  replyTo?: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Tool>;
  usage: Usage;
  adapterIndex: number;
}

export interface SkipResponse {
  status: "skip";
  raw: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Tool>;
  usage: Usage;
  adapterIndex: number;
}

export interface FailedResponse {
  status: "fail";
  raw: string;
  reason: string;
  usage: Usage;
  adapterIndex: number;
}

export type LLMResponse = SuccessResponse | SkipResponse | FailedResponse;
