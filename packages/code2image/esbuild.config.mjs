import { build } from 'esbuild';

// 执行 esbuild 构建
build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  bundle: false,
  //external: ['koishi', 'puppeteer', 'koishi-plugin-yesimbot', "@shikijs/themes", "@shikijs/langs"],
  platform: 'node',               // 目标平台
  format: 'cjs',                  // 输出格式 (CommonJS, 适合 Node)
  minify: false,
  sourcemap: true,
}).catch(() => process.exit(1));