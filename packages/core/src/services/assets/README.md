# 智能体资源中心与消息系统

## 概览

智能体资源中心与消息系统是为 Koishi 智能体（Agent）设计的集成资源管理与消息处理系统。它解决了两个核心问题：

1. **资源瞬时性**：聊天平台中的资源链接（如图片、文件）通常是临时的，直接存入长期记忆或上下文会导致其失效。
2. **上下文不友好**：Koishi 丰富的消息元素（Element）格式对于 LLM 来说难以直接理解和利用。

## 核心组件

### 1. 资源中心 (AssetService)

资源中心负责管理所有非临时性资源的生命周期：

- **持久化存储**：将临时资源下载并保存到本地或远程存储
- **统一标识**：为每个资源分配唯一的内部 ID
- **访问抽象**：提供统一的 API 进行资源访问
- **生命周期管理**：自动清理过期资源
- **智能体交互**：为 AI Agent 提供资源理解工具

### 2. 消息编解码器 (MessageTransformer)

负责在平台原生消息和 LLM 友好格式之间进行双向转换：

- **解码流程**：将平台消息转换为包含内部资源ID的格式
- **编码流程**：将内部ID转换回平台可识别的格式

### 3. 智能体资源交互工具 (AssetsExtension)

为 LLM 提供查看和理解资源内容的工具：

- `assets.view_file`：查看文件内容
- `assets.list_archive`：列出压缩包内容

## 配置

```typescript
{
  assetService: {
    storagePath: "data/yesimbot/assets",
    driver: "local",
    autoClearEnabled: true,
    autoClearIntervalHours: 24,
    maxAssetAgeDays: 30,
    endpoint: "https://your-bot.com/assets",
    maxFileSize: 104857600, // 100MB
    supportedMimeTypes: [
      "image/jpeg", "image/png", "image/gif",
      "audio/mpeg", "audio/wav",
      "video/mp4", "video/mpeg",
      "application/pdf", "text/plain",
      "application/zip"
    ]
  }
}
```

## API 使用

### 创建资源

```typescript
// 从URL创建
const id = await ctx.assets.create("https://example.com/image.jpg");

// 从Buffer创建
const buffer = Buffer.from("file content");
const id = await ctx.assets.create(buffer, { filename: "test.txt" });

// 从本地文件创建
const id = await ctx.assets.create("file:///path/to/file.pdf");
```

### 获取资源

```typescript
// 获取资源内容
const buffer = await ctx.assets.get(id);

// 获取资源信息
const info = await ctx.assets.getInfo(id);

// 获取公开访问URL
const url = await ctx.assets.getURL(id);
```

### 管理命令

- `asset.clear [-a <days>]`：手动清理过期资源
- `asset.stats`：查看资源统计信息
- `asset.info <id>`：查看指定资源详细信息

## 工作流程示例

1. **用户发送文件**：
   ```
   用户: [发送PDF文件]
   ```

2. **系统自动处理**：
   - 消息转换器捕获 `<file src="temp-url">` 元素
   - 调用 `ctx.assets.create()` 下载并存储文件
   - 转换为 `<file id="uuid">` 格式

3. **LLM 交互**：
   ```
   用户: "帮我总结这个文件"
   LLM: 调用 assets.view_file(id="uuid")
   系统: 返回PDF文本内容
   LLM: 基于内容生成总结
   ```

4. **发送回复**：
   - LLM 生成包含资源引用的回复
   - 编码器将内部ID转换为公开URL
   - 用户收到可访问的资源

## 扩展性

### 自定义存储驱动

```typescript
class S3StorageDriver implements StorageDriver {
  async write(id: string, buffer: Buffer): Promise<void> {
    // 实现S3上传逻辑
  }
  
  async read(id: string): Promise<Buffer> {
    // 实现S3下载逻辑
  }
  
  async delete(id: string): Promise<void> {
    // 实现S3删除逻辑
  }
}
```

### 自定义文件分析器

可以扩展 `AssetsExtension` 来支持更多文件类型的内容分析，如：

- PDF 文本提取（使用 pdf-parse）
- 图像识别（使用多模态模型）
- 压缩包解析（使用 unzipper）
- Office 文档解析（使用 mammoth）

## 注意事项

1. **文件大小限制**：默认最大 100MB，可通过配置调整
2. **MIME 类型支持**：只处理配置中指定的文件类型
3. **存储空间管理**：定期清理过期资源，防止空间无限膨胀
4. **安全考虑**：公开访问端点需要适当的访问控制

## 故障排除

### 常见问题

1. **资源创建失败**：
   - 检查文件大小是否超限
   - 确认MIME类型是否支持
   - 验证网络连接和URL有效性

2. **资源访问失败**：
   - 确认资源ID是否存在
   - 检查存储驱动是否正常工作
   - 验证文件是否被意外删除

3. **自动清理问题**：
   - 检查定时任务配置
   - 确认数据库连接正常
   - 验证存储驱动的删除权限

### 日志调试

启用调试日志来排查问题：

```typescript
{
  system: {
    logging: {
      level: "debug"
    }
  }
}
```

相关日志标签：
- `[资源中心]`：AssetService 相关日志
- `[消息编解码器]`：MessageTransformer 相关日志
- `[本地存储驱动]`：LocalStorageDriver 相关日志
