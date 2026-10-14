# yakumo-client 踩坑记录

这个包存在的唯一理由是把 Koishi console 的前端构建接进 `yakumo build`。
下面每一条都是它**不得不**这样写的直接原因，删掉任何一条这个包就失去意义。

## 为什么官方插件不够用

`@koishijs/client/lib` 自带一个 yakumo 插件，但它在 yakumo 1.x 和 3.x 之间不兼容。

它注册的是 **service**：

```js
// @koishijs/client/lib/index.js
const inject = ["yakumo"];
function apply(ctx) {
    ctx.register("client", async () => {
        /* ... */
    });
}
```

而 yakumo 3.2.1 的 pipeline 只派发 **CLI 命令**：

```js
// yakumo/lib/index.js
for (const name in config.pipeline) {
    ctx.cli.command(`${name} [...args]`, { unknownOption: "allow" }).action(async ({ args, options }) => {
        for (const task of config.pipeline[name]) {
            await ctx.cli.execute(new Input.String(task), args, options);
        }
    });
}
```

`ctx.register("client")` 里的 service 在 v1 能被 pipeline 触及，v3 触及不到：

```
$ npx yakumo client
Error: unknown command
```

`koishi-boilerplate` 模板的 `pipeline.build: [tsc, esbuild, client]` 能跑，是因为它锁在
`yakumo@1.0.0`。**抄配置前先看版本**，两个版本的 pipeline 语义不同。

所以这里重写成一个 CLI 命令，内部直接调 `@koishijs/client` 导出的 `build()`——
构建逻辑不重复，只是换了个入口。

## 装载路径的两个坑

`yakumo.yml` 的 `- name: X` 由 `@cordisjs/plugin-loader` 解析，两条分支互不相干：

```js
// @cordisjs/plugin-loader
import(name, getOuterStack) {
  if (this.ctx.loader.internal) { /* yakumo 自定义分支 */ }
  else if (name.startsWith(".")) {
    return await import(new URL(name, this.ctx.baseUrl).href);  // ← 相对仓库根
  } else {
    const resolve = await createResolve(this.ctx.baseUrl);      // ← 相对 .cordis/
    return await import(resolve(name));
  }
}
```

**坑 1：`./` 分支不做目录索引解析。**
`.` 分支用 `new URL(name, baseUrl)`，得到的是一个**目录 URL**，
而 `import()` 对 file URL 不会补 `index.js`，所以
`- name: "./packages/yakumo-client"` 静默失败。必须写到文件：
`- name: "./packages/yakumo-client/index.js"`。裸名 `yakumo-client` 走另一条分支，不受此影响。

**坑 2：workspace 内的包不在 `node_modules` 里。**
bun 的 isolated linker 不给 workspace 成员建顶层链接，
`import.meta.resolve("yakumo-client")` 直接 `ERR_MODULE_NOT_FOUND`——
尽管 `yakumo-tsc` 同样在 workspace 之外，它能解析是因为它来自 npm registry。

解法是让根 `package.json` 显式引用本地包：

```json
"devDependencies": { "yakumo-client": "file:./packages/yakumo-client" }
```

`file:` 会强制建 `node_modules/yakumo-client` 链接，loader 才能解析到。
`packages/*` 已在 workspaces 里，但那只影响依赖解析，不影响 loader 的 specifier 解析。

两条分支现在都可用（裸名靠 node_modules 链接，`./…/index.js` 靠 baseUrl），
但裸名依赖 `file:` 依赖先装好——`yakumo.yml` 在 `bun install` 之前解析会直接失败。
保持用裸名，与 `yakumo-tsc` / `yakumo-esbuild` 的写法一致。

## 排查手法

loader 把插件加载错误吞进 `ctx.logger.error`，`yakumo --help` 和 `yakumo list` 都看不到。
两个有效的探针：

```bash
# 1. 确认 specifier 能不能解析（注意基准目录差异）
node -e "import('file:///<repo>/.cordis/resolve.mjs').then(m =>
  console.log(m.default('yakumo-client')))"

# 2. 确认模块本身可加载
node -e "import('file:///<repo>/packages/yakumo-client/index.js').then(console.log)"
```

`yakumo --help` 列出的是 CLI 命令，service 不会出现在里面——
`client` 不出现只说明没注册成命令，不能推断插件没被加载。

## 调试残留

`.cordis/` 由 loader 自动生成，内含自己的 `.gitignore`（`*`），不需要手动加进根 gitignore。
排查时如果自己写了 `.cordis/rt.mjs` 之类的探针，记得删——`git status` 看不到它们。

## 输出目录：lib 与 dist 的分工

这个包不产出任何构建物，但仓库里 `dist` 和 `lib` 的语义是分开的：

| 目录    | 产出者                     | 内容                                            |
| ------- | -------------------------- | ----------------------------------------------- |
| `lib/`  | `tsc` + `esbuild`(dumble)  | Node 侧的 `.d.ts` / `.cjs` / `.js`              |
| `dist/` | `@koishijs/client` 的 vite | console 前端 bundle（`index.js` + `style.css`） |

`dist` 归前端独占，理由是 `plugins/console/src/index.ts` 的注册路径直接指向它：

```ts
ctx.console.addEntry({
    dev: path.resolve(__dirname, "../client/index.ts"),
    prod: path.resolve(ctx.baseDir, "node_modules", PACKAGE_NAME, "dist"),
});
```

`outDir` 写在每个包的 `tsconfig.json` 里（`tsconfig.base.json` 不设默认值）。
dumble 会跟随它决定 esbuild 的输出位置：

```js
outDir = tsconfig.compilerOptions.outDir ?? dirname(outFile);
```

所以改 `tsconfig.json` 的 `outDir` 会同时搬走 tsc 和 esbuild 的产物，
`package.json` 的 `main` / `types` / `exports` / `files` 必须一起改。

只有带 `client/` 目录的包（`plugins/console`、`plugins/usage`）在 `files` 里同时列两者。
