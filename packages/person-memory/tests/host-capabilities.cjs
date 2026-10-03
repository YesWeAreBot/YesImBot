// Run after building core: node tests/host-capabilities.cjs /path/to/legacy/core
// Uses the real compiled core service prototypes and Koishi plugin lifecycle;
// models, adapters and the remainder of the full core are intentionally absent.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, fixture } = require('./helpers.cjs');
const plugin = load('index');
const { PersonStore, sceneKey } = load('store');
const legacy = process.argv[2];
assert.ok(legacy, 'provide the built legacy core directory');
const defaults = { enabled: true, mode: 'review', modelGroup: '', summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };
for (const [version, core] of [['legacy', legacy], ['current', path.resolve(__dirname, '../../core')]]) {
    test(`real Koishi loads person-memory against ${version} core service capabilities`, async t => {
        const { ToolService } = require(path.join(core, 'lib/services/extension/service.js'));
        const { WorldStateService } = require(path.join(core, 'lib/services/worldstate/service.js'));
        const tools = new Map(), errors = [], effects = [];
        const world = Object.create(WorldStateService.prototype);
        world.isChannelAllowed = () => true;
        const tool = Object.create(ToolService.prototype);
        tool.registerTool = entry => { effects.push('tool'); tools.set(entry.name, entry); };
        tool.unregisterTool = name => tools.delete(name);
        const app = await fixture(t, () => {});
        app.on('internal/error', error => errors.push(error));
        app.set('yesimbot.tool', tool);
        app.set('yesimbot.world-state', world);
        app.set('yesimbot.prompt', { inject: () => { effects.push('prompt'); return () => {}; } });
        const fork = app.plugin(plugin, defaults);
        await new Promise(setImmediate);
        if (version === 'legacy') {
            assert.equal(world.capabilities, undefined);
            assert.equal(tool.capabilities, undefined);
            assert.match(String(errors[0]), /3\.0\.4.*beforeUserStimulus.*trustedToolSession/);
            assert.deepEqual(effects, []);
            assert.equal(app.model.tables['person_memory.state'], undefined);
            assert.equal(app.$commander.get('people.status'), undefined);
        } else {
            assert.equal(world.capabilities.beforeUserStimulus, 1);
            assert.equal(tool.capabilities.trustedToolSession, 1);
            assert.deepEqual(errors, []);
            await app.database.prepared();
            const s = { platform: 'onebot', selfId: 'b', bot: { selfId: 'b' }, channelId: 'g', userId: 'u', messageId: 'm', timestamp: 1, content: 'hello', author: { name: 'U' } };
            await app.parallel('yesimbot/before-user-stimulus', s);
            const store = new PersonStore(app.database, 'off');
            assert.ok(await store.find(sceneKey(s), 'u'));
            assert.equal((await store.sources(sceneKey(s), 'u'))[0].text, 'hello');
            assert.ok(tools.has('person_memory'));
            assert.ok(app.$commander.get('people.status'));
        }
        fork.dispose();
    });
}
