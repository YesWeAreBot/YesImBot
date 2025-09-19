import { build } from 'esbuild';

// 执行 esbuild 构建
build({
    entryPoints: ['src/index.ts'],
    outdir: 'lib',
    bundle: true,
    platform: 'node',               // 目标平台
    format: 'cjs',                  // 输出格式 (CommonJS, 适合 Node)
    minify: false,
    sourcemap: true,
    external: ["koishi-plugin-yesimbot", "koishi", "ws", "@msgpack/msgpack", "undici", "uuid"]
}).catch(() => process.exit(1));