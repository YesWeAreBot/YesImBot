import { ModelDescriptor } from "koishi-plugin-yesimbot";

export interface StickerConfig {
    storagePath: string;
    classifiModel: ModelDescriptor;
    classificationPrompt: string;
}
