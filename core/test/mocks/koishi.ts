import { h } from "koishi";

// Mock h.parse behavior for tests
export function mockHParse(xml: string) {
  return h.parse(xml);
}

// Mock session for testing sendMessage
export function createMockSession() {
  const sent: unknown[] = [];
  return {
    send: (elements: unknown[]) => {
      sent.push(...elements);
      return Promise.resolve();
    },
    getSent: () => sent,
    clearSent: () => {
      sent.length = 0;
    },
  };
}

// Mock context for testing
export function createMockContext() {
  return {
    bots: [],
  };
}
