# Core 构建补充步骤

`yakumo build` 依次运行 TypeScript 声明生成、服务端 esbuild 构建和本插件提供的 `client` 命令。

当前 core 配置页的入口是 `client/index.js`，使用 `scripts/build-client.mjs` 生成 `dist/index.js` 与 `dist/style.css`。它不使用 `@koishijs/client` 的 Vite 构建流程。

core 的模型依赖属于 ESM 包，通过 `scripts/bundle.mjs` 打包到 `lib/dependencies/xsai.js`，供 CommonJS 插件加载。该步骤需要在通用 esbuild 构建后运行，避免被覆盖。

本插件只处理所选工作区中的 `koishi-plugin-yesimbot`，按顺序执行上述两个脚本；任意步骤失败都会中止流水线。根项目通过 `workspace:*` 引用本插件。
