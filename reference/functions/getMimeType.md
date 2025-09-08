[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / getMimeType

# Function: getMimeType()

> **getMimeType**(`data`): `string`

Defined in: [packages/core/src/shared/utils/toolkit.ts:325](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/shared/utils/toolkit.ts#L325)

根据文件 Buffer 数据判断文件的 MIME 类型

## Parameters

### data

文件的 Buffer 数据。在 Node.js 中是 Buffer，在浏览器中可以是 Uint8Array。

`Uint8Array`\<`ArrayBufferLike`\> | `Buffer`\<`ArrayBufferLike`\>

## Returns

`string`

文件的 MIME 类型字符串。如果无法识别，则返回 'application/octet-stream'。
