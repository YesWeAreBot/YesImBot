import { build } from 'esbuild';
import fs from 'fs';

const { dependencies } = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// 获取所有依赖
const allDeps = Object.keys(dependencies || {});
// 保留的依赖
const include = [
    'xsai',
    '@xsai-ext/providers-cloud',
    '@xsai-ext/providers-local',
    '@xsai-ext/shared-providers',
    '@xsai/utils-reasoning',
];
// 剩下的设为 external
const external = allDeps.filter(dep => !include.includes(dep));

external.push(
    'effect',
    '@valibot/to-json-schema',
    '@koishijs/core',
    'inaba',
    'cosmokit',
    'ns-require',
    'koishi',
    'zod',
    'zod-to-json-schema',
)

build({
    entryPoints: ['./src/dependencies/xsai.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: './lib/dependencies/xsai.js',
    external,
    sourcemap: false,
    minify: true,
    logLevel: 'info',
}).catch((error) => {
    process.exit(1);
})