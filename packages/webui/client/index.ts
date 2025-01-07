import { Context } from "@koishijs/client";
import View from "./views/MemoryView.vue";

export default (ctx: Context) => {
  ctx.page({
    name: "记忆管理",
    path: "/memory",
    component: View,
  });
};
