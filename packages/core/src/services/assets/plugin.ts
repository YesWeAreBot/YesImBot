import { Context } from "koishi";
import { Services } from "../types";
import { AssetService } from "./service";
import { MessageTransformer } from "./transformer";

/**
 * 资源中心插件
 * 自动注册消息转换器中间件
 */
export function apply(ctx: Context) {
    // 等待AssetService就绪
    ctx.on('ready', () => {
        const assetService = ctx[Services.Asset];
        if (assetService) {
            // 创建并注册消息转换器
            const transformer = new MessageTransformer(ctx);
            transformer.register();
            
            ctx.logger.info("资源中心消息转换器已启用");
        } else {
            ctx.logger.warn("AssetService未找到，消息转换器未启用");
        }
    });
}
