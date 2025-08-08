[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ReadAssetOptions

# Interface: ReadAssetOptions

Defined in: [packages/core/src/services/assets/types.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/assets/types.ts#L53)

读取资源时的选项

## Properties

### format?

> `optional` **format**: `"base64"` \| `"buffer"` \| `"data-url"`

Defined in: [packages/core/src/services/assets/types.ts:55](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/assets/types.ts#L55)

输出格式

***

### image?

> `optional` **image**: [`ImageProcessingOptions`](ImageProcessingOptions.md)

Defined in: [packages/core/src/services/assets/types.ts:57](https://github.com/YesWeAreBot/YesImBot/blob/1cc026757645693fc4276f09bfc024895000403c/packages/core/src/services/assets/types.ts#L57)

针对图片资源的特定处理选项
