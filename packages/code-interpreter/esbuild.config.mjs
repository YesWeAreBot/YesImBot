import { build } from 'esbuild';

// 执行 esbuild 构建
build({
  entryPoints: ['src/**/*.ts'],
  outdir: 'lib',
  bundle: false,
  platform: 'node',               // 目标平台
  format: 'cjs',                  // 输出格式 (CommonJS, 适合 Node)
  minify: false,
  sourcemap: true,
}).catch(() => process.exit(1));