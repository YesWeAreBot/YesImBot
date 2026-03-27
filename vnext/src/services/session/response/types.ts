export interface ResponseDispatchConfig {
  maxChars: number;
  debugLevel?: number;
}

export interface ResponseSendContext {
  sendFn: (content: string) => Promise<void>;
  injectSystemMessage: (text: string) => void;
  channelKey: string;
}
