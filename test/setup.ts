import { Context } from "@koishijs/core";
import memory from "@koishijs/plugin-database-memory";
import mock from "@koishijs/plugin-mock";

export function createTestApp() {
  const app = new Context();

  app.plugin(mock);
  app.plugin(memory);

  return app;
}
