import { Context } from "@koishijs/client";
import Status from "./slots/Status.vue";


export default (ctx: Context) => {
    ctx.slot({
        type: 'plugin-details',
        component: Status,
        order: -500,
    });
}