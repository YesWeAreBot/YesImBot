[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / downloadFile

# Function: downloadFile()

> **downloadFile**(`url`, `filePath`, `overwrite`): `Promise`\<`void`\>

Defined in: [packages/core/src/shared/utils/toolkit.ts:92](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/shared/utils/toolkit.ts#L92)

从 URL 下载文件并保存到本地，支持流式写入以优化大文件处理。

## Parameters

### url

`string`

文件 URL。

### filePath

`string`

本地保存路径（包含文件名）。

### overwrite

`boolean` = `false`

如果文件已存在，是否覆盖。默认为 false。

## Returns

`Promise`\<`void`\>

## Throws

如果下载失败、文件已存在且 overwrite 为 false，则会抛出错误。
