import { build } from 'esbuild';
import { readFileSync } from 'fs';

// 读取 package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// 获取所有 dependencies 和 peerDependencies
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
];

// 执行 esbuild 构建
build({
  entryPoints: ['src/index.ts'], // 入口文件，这里使用 tsc 的输出
  outfile: 'lib/index.js',       // 最终输出文件
  bundle: true,
  platform: 'node',               // 目标平台
  format: 'cjs',                  // 输出格式 (CommonJS, 适合 Node)
  minify: false,
  sourcemap: true,
  external: external,             // 关键配置：将所有依赖项设为外部
}).catch(() => process.exit(1));