import { Context } from "@koishijs/client";
import Page from "./page.vue";
import StatisticsPage from "./pages/StatisticsPage.vue";
import EditPage from "./pages/EditPage.vue";

export default (ctx: Context) => {
  ctx.page({
    name: "记忆管理",
    path: "/memory",
    component: Page,
  });
};
