const maxPixels = 25_000_000;
const maxAnimationPixels = 40_000_000;
const maxFrames = 256;

function checkPixels(width: number, height: number): void {
    if (width <= 0 || height <= 0 || width * height > maxPixels) throw new Error("图片尺寸超限或无效");
}

function checkGif(data: Buffer): void {
    const width = data.readUInt16LE(6);
    const height = data.readUInt16LE(8);
    checkPixels(width, height);
    const packed = data[10];
    let offset = 13 + (packed & 128 ? 3 * (2 << (packed & 7)) : 0);
    let frames = 0;
    let pixels = 0;
    while (offset < data.length) {
        const marker = data[offset++];
        if (marker === 0x3b) return;
        if (marker === 0x21) {
            offset++;
        } else if (marker === 0x2c) {
            const frameWidth = data.readUInt16LE(offset + 4);
            const frameHeight = data.readUInt16LE(offset + 6);
            const flags = data[offset + 8];
            offset += 9 + (flags & 128 ? 3 * (2 << (flags & 7)) : 0) + 1;
            checkPixels(frameWidth, frameHeight);
            pixels += Math.max(width * height, frameWidth * frameHeight);
            if (++frames > maxFrames || pixels > maxAnimationPixels) throw new Error("GIF 动画帧数或像素超限");
        } else {
            throw new Error("GIF 块无效");
        }
        while (offset < data.length) {
            const length = data[offset++];
            if (!length) break;
            offset += length;
        }
    }
    throw new Error("GIF 未完整结束");
}

export function assertImageBudget(data: Buffer, mime: string): void {
    switch (mime) {
        case "image/png":
            checkPixels(data.readUInt32BE(16), data.readUInt32BE(20));
            return;
        case "image/gif":
            checkGif(data);
            return;
        case "image/bmp":
        case "image/x-ms-bmp":
            if (data.readUInt32LE(14) === 12) checkPixels(data.readUInt16LE(18), data.readUInt16LE(20));
            else checkPixels(data.readInt32LE(18), Math.abs(data.readInt32LE(22)));
            return;
        case "image/jpeg": {
            for (let offset = 2; offset + 3 < data.length;) {
                if (data[offset++] !== 0xff) break;
                while (data[offset] === 0xff) offset++;
                const marker = data[offset++];
                if (marker === 0xda || marker === 0xd9) break;
                const length = data.readUInt16BE(offset);
                if (length < 2 || offset + length > data.length) break;
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
                    checkPixels(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
                    return;
                }
                offset += length;
            }
            throw new Error("找不到有效的 JPEG 尺寸");
        }
        default:
            return;
    }
}
