const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Context } = require('koishi');
const sqlite = require('@minatojs/driver-sqlite').default;
const groups = new WeakMap();

function load(name) {
    const filename = path.resolve(__dirname, '../src', `${name}.ts`);
    const result = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['koishi'] });
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(result.outputFiles[0].text, filename);
    return mod.exports;
}
async function fixture(t, register) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yib-person-'));
    const app = new Context({ baseDir: dir });
    app.plugin(sqlite, { path: path.join(dir, 'memory.db') });
    register(app);
    await app.start();
    await app.database.prepared();
    const group={dir,apps:[app]};groups.set(app,group);
    t.after(async () => { for(const instance of group.apps)await instance.stop();fs.rmSync(dir, { recursive: true, force: true }); });
    return app;
}
async function reopen(app,register) {
    const group=groups.get(app);await app.stop();
    const next=new Context({baseDir:group.dir});
    next.plugin(sqlite,{path:path.join(group.dir,'memory.db')});register(next);
    await next.start();await next.database.prepared();group.apps.push(next);groups.set(next,group);return next;
}
module.exports = { load, fixture, reopen };
