import { ModelDescriptor } from "koishi-plugin-yesimbot/services";

export interface StickerConfig {
    storagePath: string;
    classifiModel: ModelDescriptor;
    classificationPrompt: string;
}
