declare module "@miaowfish/gifwrap" {
    export interface GifFrameData {
        bitmap: {
            width: number;
            height: number;
            data: Buffer;
        };
        delayCentisecs?: number;
        disposalMethod?: number;
    }
    export const GifUtil: {
        read(path: string | Buffer): Promise<{ width: number; height: number; frames: GifFrameData[] }>;
        write(path: string, frames: GifFrameData[]): Promise<void>;
        quantizeSorland(buffer: any, colors: number): GifFrameData;
        copyFrame(data: any): GifFrameData;
        [key: string]: any;
    };
}
