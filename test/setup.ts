import { Context } from "@koishijs/core";
import memory from "@koishijs/plugin-database-memory";
import mock from "@koishijs/plugin-mock";

export function createTestApp() {
  const app = new Context();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.plugin(mock as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.plugin(memory as any);

  return app;
}
