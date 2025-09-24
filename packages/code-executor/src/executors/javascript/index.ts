// import { exec } from "child_process";
// import fs from "fs/promises";
// import ivm from "isolated-vm";
// import { Context, Logger, Schema } from "koishi";
// import { AssetService, ToolDefinition, withInnerThoughts } from "koishi-plugin-yesimbot/services";
// import { Services } from "koishi-plugin-yesimbot/shared";
// import path from "path";
// import { promisify } from "util";

// import { SharedConfig } from "../../config";
// import { CodeExecutionResult, CodeExecutor, ExecutionArtifact, ExecutionError } from "../base";

// const asyncExec = promisify(exec);

// interface ProcessedArtifactsResult {
//     artifacts: ExecutionArtifact[];
//     errorMessages: string[];
// }

// export interface JavaScriptConfig {
//     type: "javascript";
//     enabled: boolean;
//     packageManager: "npm" | "yarn" | "bun" | "pnpm";
//     registry: string;
//     timeout: number;
//     memoryLimit: number;
//     allowedBuiltins: string[];
//     allowedModules: string[];
//     customToolDescription: string;
// }

// export const JavaScriptConfigSchema: Schema<JavaScriptConfig> = Schema.intersect([
//     Schema.object({
//         type: Schema.const("javascript").hidden().description("引擎类型"),
//         enabled: Schema.boolean().default(false).description("是否启用此引擎"),
//     }).description("JavaScript 执行引擎"),
//     Schema.union([
//         Schema.object({
//             enabled: Schema.const(true).required(),
//             timeout: Schema.number().default(10000).description("代码执行的超时时间（毫秒）"),
//             packageManager: Schema.union(["npm", "yarn", "bun", "pnpm"]).default("npm").description("用于动态安装依赖的包管理器"),
//             registry: Schema.string().default("https://registry.npmmirror.com").description("npm包的自定义注册表URL"),
//             memoryLimit: Schema.number().min(64).default(128).description("代码执行的内存限制（MB）"),
//             allowedBuiltins: Schema.array(String)
//                 .default(["path", "util", "crypto"])
//                 .role("table")
//                 .description("允许使用的Node.js内置模块"),
//             allowedModules: Schema.array(String).default([]).role("table").description("允许动态安装的外部npm模块白名单"),
//             customToolDescription: Schema.string()
//                 .role("textarea", { rows: [2, 4] })
//                 .description("自定义工具描述，留空则使用默认描述"),
//         }),
//         Schema.object({}),
//     ]),
// ]) as Schema<JavaScriptConfig>;

// export class JavaScriptExecutor implements CodeExecutor {
//     public static readonly type = "javascript";
//     readonly type = JavaScriptExecutor.type;

//     private readonly logger: Logger;
//     private assetService: AssetService;

//     private isolate: ivm.Isolate;
//     private hostRequireCallback: ivm.Callback;

//     private proxiedModuleCache = new Map<string, any>();
//     private proxyToTargetMap = new WeakMap<object, any>();

//     constructor(
//         private ctx: Context,
//         private config: JavaScriptConfig,
//         private sharedConfig: SharedConfig
//     ) {
//         this.logger = ctx.logger(`[executor:${this.type}]`);
//         this.assetService = ctx.get(Services.Asset);

//         if (this.config.enabled) {
//             this.initializeIsolate();

//             ctx.on("dispose", () => {
//                 if (this.isolate && !this.isolate.isDisposed) {
//                     this.logger.info("Disposing the Isolate instance...");
//                     this.isolate.dispose();
//                 }
//             });
//         }

//         this.logger.info("JavaScript executor initialized.");
//     }

//     private initializeIsolate() {
//         this.logger.info("Initializing new Isolate instance...");
//         this.isolate = new ivm.Isolate({ memoryLimit: this.config.memoryLimit });

//         this.proxiedModuleCache.clear();

//         this.hostRequireCallback = new ivm.Callback((moduleName: string) => {
//             try {
//                 if (this.proxiedModuleCache.has(moduleName)) {
//                     return new ivm.ExternalCopy(this.proxiedModuleCache.get(moduleName)).copyInto();
//                 }

//                 const resolvedPath = require.resolve(moduleName, { paths: [this.sharedConfig.dependenciesPath] });
//                 const requiredModule = require(resolvedPath);

//                 const proxiedModule = this.createDeepProxy(requiredModule, ivm, requiredModule);
//                 this.proxiedModuleCache.set(moduleName, proxiedModule);

//                 return new ivm.ExternalCopy(proxiedModule).copyInto();
//             } catch (error: any) {
//                 throw new Error(`Host require failed for module '${moduleName}': ${error.message}`);
//             }
//         });
//     }

//     public getToolDefinition(): ToolDefinition {
//         const defaultDescription = `<details>在一个隔离的、安全的Node.js沙箱环境中执行JavaScript代码
// - 你可以使用 require() 导入模块，但仅限于管理员配置的内置模块和外部模块白名单
// - 可用内置模块: ${this.config.allowedBuiltins.join(", ") || "无"}
// - 可用外部模块: ${this.config.allowedModules.join(", ") || "无"}
// - 必须使用 console.log() 输出结果，它将作为 stdout 返回
// - 返回结果仅你可见，根据返回结果调整你的下一步行动
// - 任何未捕获的异常或执行超时都将导致工具调用失败
// - 你无法直接访问文件系统（如 \`fs\` 模块）。要创建文件、图片或任何数据产物，你必须使用全局提供的异步函数 \`__createArtifact__\`
// - **函数签名:** \`async function __createArtifact__(fileName: string, content: string | ArrayBuffer, type: string): Promise<void>\`
// - **参数说明:**
//   - fileName: 你希望为文件指定的名字，例如 'data.csv' 或 'chart.png'。
//   - content: 文件内容。
//     - 对于文本文件（如JSON, CSV, HTML），请提供字符串。
//     - 对于二进制文件（如图片、压缩包），请提供 \`ArrayBuffer\` 格式的数据。
//   - type: 资源的类型。**必须是以下之一**:
//     - 'text': 纯文本文档。
//     - 'json': JSON 数据。
//     - 'html': HTML 文档。
//     - 'image': 图片文件（如 PNG, JPEG, SVG）。
//     - 'file': 其他通用二进制文件。</details>`;

//         return {
//             name: "execute_javascript",
//             description: this.config.customToolDescription || defaultDescription,
//             parameters: withInnerThoughts({
//                 code: Schema.string().required().description("要执行的JavaScript代码字符串"),
//             }),
//             execute: async ({ code }) => this.execute(code),
//         };
//     }

//     public async execute(code: string): Promise<CodeExecutionResult> {
//         this.logger.info(`Received code execution request.`);

//         try {
//             await this.prepareEnvironment(code);
//         } catch (error: any) {
//             this.logger.error("Environment preparation failed.", error);
//             return {
//                 status: "error",
//                 error: {
//                     name: "EnvironmentError",
//                     message: error.message,
//                     stack: error.stack,
//                     suggestion: "请检查模块名是否正确，或请求管理员将所需模块添加到白名单中。",
//                 },
//             };
//         }

//         let context: ivm.Context | null = null;
//         try {
//             const { context: newContext, capturedLogs, artifactRequests } = await this._createAndSetupContext();
//             context = newContext; // 将创建的 context 赋值给外部变量以便 finally 中释放

//             const wrappedCode = `(async () => { ${code} })();`;
//             await context.eval(wrappedCode, { timeout: this.config.timeout });

//             const stdout = capturedLogs
//                 .filter((l) => l.level === "log")
//                 .map((l) => l.message)
//                 .join("\n");
//             const stderr = capturedLogs
//                 .filter((l) => l.level !== "log")
//                 .map((l) => l.message)
//                 .join("\n");
//             const { artifacts, errorMessages } = await this._processArtifactRequests(artifactRequests);

//             return {
//                 status: "success",
//                 result: {
//                     stdout: this.truncate(stdout),
//                     stderr: this.truncate(stderr),
//                     artifacts: artifacts,
//                     ...(errorMessages.length > 0 ? { artifactCreationErrors: errorMessages } : {}),
//                 },
//             };
//         } catch (error: any) {
//             const execError = error as ExecutionError;
//             return {
//                 status: "error",
//                 error: {
//                     name: execError.name || "ExecutionError",
//                     message: execError.message,
//                     stack: execError.stack,
//                     suggestion: execError.suggestion || "请检查代码中的语法错误、变量拼写或异步操作是否正确处理。",
//                 },
//             };
//         } finally {
//             if (context) {
//                 try {
//                     context.release();
//                 } catch (e) {
//                     this.logger.warn("Failed to release context. Re-initializing the Isolate.", e);
//                     if (this.isolate && !this.isolate.isDisposed) this.isolate.dispose();
//                     this.initializeIsolate();
//                 }
//             }
//         }
//     }

//     /**
//      * [优化] 提取出的私有方法，专门负责创建和配置沙箱上下文。
//      * @returns 一个包含新上下文、日志捕获器和产物请求数组的对象。
//      */
//     private async _createAndSetupContext() {
//         const context = await this.isolate.createContext();
//         const jail = context.global;
//         await jail.set("global", jail.derefInto());

//         const capturedLogs: { level: string; message: string }[] = [];
//         const artifactRequests: any[] = [];
//         // 注入 console
//         const logCallback = new ivm.Reference((level: string, ...args: any[]) => {
//             const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg, null, 2))).join(" ");
//             capturedLogs.push({ level, message });
//         });
//         await context.evalClosure(
//             `global.console = { log: (...args) => $0.applyIgnored(undefined, ['log', ...args]), error: (...args) => $0.applyIgnored(undefined, ['error', ...args]), warn: (...args) => $0.applyIgnored(undefined, ['warn', ...args]) };`,
//             [logCallback]
//         );

//         // 注入 __createArtifact__
//         const artifactCallback = new ivm.Callback((fileName: string, content: any, type: string) => {
//             const buffer = content instanceof ArrayBuffer ? Buffer.from(content) : Buffer.from(String(content));
//             artifactRequests.push({ fileName, content: buffer, type });
//         });
//         await jail.set("__createArtifact__", artifactCallback);

//         // 注入 require
//         await jail.set("__host_require__", this.hostRequireCallback);
//         await context.eval(`
//                 const moduleCache = {};
//                 global.require = (moduleName) => {
//                     if (moduleCache[moduleName]) return moduleCache[moduleName];
//                     const m = __host_require__(moduleName);
//                     moduleCache[moduleName] = m;
//                     return m;
//                 };
//             `);

//         return { context, capturedLogs, artifactRequests };
//     }

//     private async prepareEnvironment(code: string): Promise<void> {
//         await fs.mkdir(this.sharedConfig.dependenciesPath, { recursive: true });
//         const packageJsonPath = path.join(this.sharedConfig.dependenciesPath, "package.json");
//         try {
//             await fs.access(packageJsonPath);
//         } catch {
//             await fs.writeFile(packageJsonPath, JSON.stringify({ name: "sandbox-dependencies", private: true }));
//         }

//         const requiredModules = [...code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
//         if (requiredModules.length === 0) return;

//         this.logger.debug(`Detected required modules: ${requiredModules.join(", ")}`);
//         const uniqueModules = [...new Set(requiredModules)];
//         const allowedSet = new Set([...this.config.allowedBuiltins, ...this.config.allowedModules]);

//         // [优化] 收集所有需要安装的、且未安装的模块
//         const modulesToInstall: string[] = [];

//         for (const moduleName of uniqueModules) {
//             if (!allowedSet.has(moduleName)) {
//                 const suggestion = `你可以使用的模块列表为: [${[...allowedSet].join(", ")}]。`;
//                 throw new Error(`模块导入失败: 模块 '${moduleName}' 不在允许的白名单中。\n${suggestion}`);
//             }

//             if (this.config.allowedBuiltins.includes(moduleName)) {
//                 this.logger.debug(`Skipping installation for built-in module: ${moduleName}`);
//                 continue;
//             }

//             try {
//                 require.resolve(moduleName, { paths: [this.sharedConfig.dependenciesPath] });
//                 this.logger.info(`Dependency '${moduleName}' is already installed.`);
//             } catch {
//                 this.logger.info(`Dependency '${moduleName}' is not installed. Queuing for installation.`);
//                 modulesToInstall.push(moduleName);
//             }
//         }

//         // [优化] 如果有需要安装的模块，则执行一次性的批量安装
//         if (modulesToInstall.length > 0) {
//             this.logger.info(`Installing new dependencies: ${modulesToInstall.join(", ")}`);
//             await this._installPackages(modulesToInstall);
//         }
//     }

//     /**
//      * [优化] 使用配置的包管理器批量安装指定的包。
//      * @param moduleNames 要安装的模块名数组。
//      */
//     private async _installPackages(moduleNames: string[]): Promise<void> {
//         if (moduleNames.length === 0) return;

//         const pm = this.config.packageManager;
//         const modulesString = moduleNames.join(" ");
//         let installCommand: string;

//         switch (pm) {
//             case "yarn":
//                 installCommand = `yarn add ${modulesString} --silent --non-interactive --registry ${this.config.registry}`;
//                 break;
//             case "bun":
//                 installCommand = `bun add ${modulesString} --registry ${this.config.registry}`;
//                 break;
//             case "pnpm":
//                 installCommand = `pnpm add ${modulesString} --registry ${this.config.registry}`;
//                 break;
//             case "npm":
//             default:
//                 installCommand = `npm install ${modulesString} --no-save --omit=dev --registry ${this.config.registry}`;
//                 break;
//         }

//         try {
//             this.logger.info(`Executing: \`${installCommand}\` in ${this.sharedConfig.dependenciesPath}`);
//             await asyncExec(installCommand, { cwd: this.sharedConfig.dependenciesPath });
//             this.logger.info(`Successfully installed ${moduleNames.join(", ")}`);
//         } catch (error: any) {
//             const stderr = error.stderr || "No stderr output.";
//             this.logger.error(`Failed to install dependencies. Stderr: ${stderr}`, error);
//             const suggestion = `请检查模块名 '${moduleNames.join(", ")}' 是否拼写正确，以及它们是否存在于 ${pm} 仓库中。`;
//             throw new Error(`依赖安装失败: 无法安装模块。\n错误详情: ${stderr}\n${suggestion}`);
//         }
//     }

//     /**
//      * 创建一个对象的深层代理，以便安全地从主进程传递到 isolated-vm 沙箱。
//      * 这个函数会递归地遍历对象的所有属性：
//      * - 普通值 (string, number, boolean) 被直接复制。
//      * - 函数被包装在 ivm.Callback 中，允许沙箱调用主进程的函数。
//      * - 嵌套的对象和数组被递归地转换成新的代理对象/数组。
//      * - 使用 WeakMap 来处理和防止循环引用导致的无限递归。
//      * - 遍历原型链以暴露继承的属性和方法。
//      *
//      * @param target 要代理的原始对象或函数。
//      * @param ivmInstance 对 `isolated-vm` 模块的引用。
//      * @param owner 当代理函数被调用时，其在主进程中执行的 `this` 上下文。
//      * @param visited 一个 WeakMap，用于跟踪已经访问过的对象，以解决循环引用问题。
//      * @returns 一个可以被安全地复制到沙箱中的代理版本。
//      */
//     private createDeepProxy(target: any, ivmInstance: typeof ivm, owner: any, visited = new WeakMap()): any {
//         // 1. 基本类型和 null 直接返回
//         if ((typeof target !== "object" && typeof target !== "function") || target === null) {
//             return target;
//         }

//         // 2. 检查循环引用
//         if (visited.has(target)) {
//             return visited.get(target);
//         }

//         // [核心改动] 定义一个通用的参数解包函数
//         const unwrapArgs = (args: any[]): any[] => {
//             return args.map((arg) =>
//                 typeof arg === "object" && arg !== null && this.proxyToTargetMap.has(arg) ? this.proxyToTargetMap.get(arg) : arg
//             );
//         };

//         // 3. 处理函数
//         if (typeof target === "function") {
//             // [新增] 检测是否是 Class/Constructor
//             // 启发式检测：一个函数，并且其原型上有 constructor 指向自身
//             const isConstructor = target.prototype && target.prototype.constructor === target;

//             if (isConstructor) {
//                 // 如果是构造函数，使用 constructor 选项来创建回调
//                 const proxyConstructor = (...args: any[]) => {
//                     const unwrappedArgs = unwrapArgs(args);
//                     // 使用 `new` 关键字来实例化
//                     const instance = new target(...unwrappedArgs);
//                     // 同样需要代理返回的实例，以便在沙箱中可以访问其方法
//                     return this.createDeepProxy(instance, ivmInstance, instance, new WeakMap());
//                 };

//                 // @ts-ignore
//                 const callback = new ivmInstance.Callback(proxyConstructor, { constructor: { copy: true } });
//                 visited.set(target, callback);
//                 return callback;
//             } else {
//                 // 如果是普通函数，保持原有逻辑
//                 const proxyFunction = (...args: any[]) => {
//                     const unwrappedArgs = unwrapArgs(args);
//                     const result = target.apply(owner, unwrappedArgs);
//                     return this.createDeepProxy(result, ivmInstance, result, new WeakMap());
//                 };

//                 // @ts-ignore
//                 const callback = new ivmInstance.Callback(proxyFunction, { result: { copy: true } });
//                 visited.set(target, callback);
//                 return callback;
//             }
//         }

//         // 4. 处理对象和数组
//         // 创建一个空的代理对象或数组，它将填充代理后的属性。
//         const proxy = Array.isArray(target) ? [] : {};

//         // **关键步骤**：立即将新创建的空代理存入 visited 映射中。
//         // 如果后续在递归中遇到对 `target` 的循环引用，第2步的检查会立即返回这个 `proxy` 对象，
//         // 从而中断无限递归。此时 `proxy` 还是空的，但之后会被填充完整。
//         visited.set(target, proxy);
//         // 存储 代理 -> 真实目标 的映射
//         this.proxyToTargetMap.set(proxy, target);

//         // 5. 遍历原型链以获取所有属性（包括继承的属性，例如 fs.promises）。
//         let current = target;
//         while (current && current !== Object.prototype) {
//             // 使用 getOwnPropertyNames 获取所有属性，包括不可枚举的。
//             for (const key of Object.getOwnPropertyNames(current)) {
//                 // 如果代理对象中已经有了这个键（说明子类已经覆盖了它），则跳过。
//                 if (key in proxy) continue;
//                 // 过滤掉一些危险或无用的属性。
//                 if (["constructor", "prototype", "caller", "arguments"].includes(key)) continue;

//                 try {
//                     // [核心改动] 为对象的属性创建 getter/setter 代理，而不是直接赋值
//                     // 这能确保在访问属性时，我们能正确处理函数调用的 `this` 上下文
//                     Object.defineProperty(proxy, key, {
//                         enumerable: true,
//                         get: () => {
//                             // 代理属性的访问
//                             return this.createDeepProxy(target[key], ivmInstance, target, visited);
//                         },
//                         set: (value) => {
//                             // 代理属性的设置，同样需要解包
//                             const unwrappedValue =
//                                 typeof value === "object" && value !== null && this.proxyToTargetMap.has(value)
//                                     ? this.proxyToTargetMap.get(value)
//                                     : value;
//                             target[key] = unwrappedValue;
//                             return true;
//                         },
//                     });
//                 } catch (e) {
//                     // 某些属性（如废弃的 getter）在访问时可能会抛出异常，安全地忽略它们。
//                 }
//             }
//             // 移动到原型链的上一层。
//             current = Object.getPrototypeOf(current);
//         }

//         return proxy;
//     }

//     /**
//      * 新增的辅助方法，用于处理产物创建请求。
//      * @param requests 来自 worker 的产物创建请求列表。
//      */
//     private async _processArtifactRequests(requests: any[]): Promise<ProcessedArtifactsResult> {
//         if (!requests || requests.length === 0) {
//             return { artifacts: [], errorMessages: [] };
//         }

//         const createdArtifacts: ExecutionArtifact[] = [];
//         const errorMessages: string[] = [];

//         for (const req of requests) {
//             try {
//                 const resourceSource = req.content as Uint8Array;
//                 const assetId = await this.assetService.create(Buffer.from(resourceSource), { filename: req.fileName });
//                 createdArtifacts.push({ assetId, fileName: req.fileName });
//             } catch (error: any) {
//                 const errorMessage = `[Artifact Creation Failed] 资源 '${req.fileName}' 创建失败: ${error.message}`;
//                 this.logger.warn(errorMessage, error);
//                 errorMessages.push(errorMessage);
//             }
//         }
//         return { artifacts: createdArtifacts, errorMessages };
//     }

//     /**
//      * 截断过长的输出文本。
//      * @param text 输入文本。
//      * @returns 截断后的文本。
//      */
//     private truncate(text: string): string {
//         if (!text) return "";
//         const maxLength = this.sharedConfig.maxOutputSize;
//         if (text.length > maxLength) {
//             return text.substring(0, maxLength) + `\n... [输出内容过长，已被截断，限制为 ${maxLength} 字符]`;
//         }
//         return text;
//     }
// }
