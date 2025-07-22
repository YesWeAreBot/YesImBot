import { build } from 'esbuild';

// 执行 esbuild 构建
build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  bundle: true,
  external: ['koishi', 'puppeteer', 'koishi-plugin-yesimbot'],
  platform: 'node',               // 目标平台
  format: 'cjs',                  // 输出格式 (CommonJS, 适合 Node)
  minify: true,
  sourcemap: false,
}).catch(() => process.exit(1));