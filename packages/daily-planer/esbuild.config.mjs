import { build } from 'esbuild';

// 执行 esbuild 构建
build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  bundle: false,
  platform: 'node',
  format: 'cjs',
  minify: false,
  sourcemap: true,
}).catch(() => process.exit(1));
