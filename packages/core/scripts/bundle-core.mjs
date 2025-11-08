import { build } from 'esbuild';
import fs from 'fs';

const { dependencies } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// 获取所有依赖
const allDeps = Object.keys(dependencies || {});
// 保留的依赖
const include = [
    '@xsai/stream-object',
    '@xsai/utils-reasoning',
    'xsai',
];
// 剩下的设为 external
const external = allDeps.filter(dep => !include.includes(dep));

external.push(
    '@koishijs/core',
    '@valibot/to-json-schema',
    'cosmokit',
    'effect',
    'inaba',
    'koishi',
    'ns-require',
    'sury',
    'zod-to-json-schema',
    'zod',
    'undici'
)

build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: './lib/index.js',
    external,
    sourcemap: true,
    minify: false,
    logLevel: 'info',
}).catch((error) => {
    process.exit(1);
}).then((value) => {
})

build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: './lib/index.mjs',
    external,
    sourcemap: true,
    minify: false,
    logLevel: 'info',
}).catch((error) => {
    process.exit(1);
}).then((value) => {
})
