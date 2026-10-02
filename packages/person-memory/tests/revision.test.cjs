const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { load, fixture } = require('./helpers.cjs');
const { PersonStore, registerModels } = load('store');
const { renderPeople } = load('context');
const actor = 'admin:42';
async function setup(t) {
    const ctx = await fixture(t, registerModels);
    return { ctx, store: new PersonStore(ctx.database, 'review') };
}
async function accounts(store, scope = 's') {
    await store.recognize(scope, 'a', '甲');
    await store.recognize(scope, 'b', '乙');
    await store.capture(scope, { id: 'm', userId: 'a', name: '甲', text: '我是乙的小号', timestamp: 1234 });
    return { source: await store.find(scope, 'a'), target: await store.find(scope, 'b') };
}
function versions(source, target) {
    return { personId: source.person.id, personRevision: source.person.revision, accountRevision: source.accounts[0].revision, targetRevision: target.person.revision };
}

test('historical administrator changes remain discoverable by page, account, person and action', async t => {
    const { store } = await setup(t);
    const initial = await store.recognize('s', 'a', '甲');
    await store.setProfile('s', 'a', '最初的人工画像', actor);
    const old = (await store.history('s'))[0];
    for (let i = 0; i < 25; i++) await store.rename('s', 'a', `称呼${i}`, actor);
    await store.recognize('other', 'a', '其他群的秘密');
    const first = await store.history('s', 10);
    const later = await store.history('s', 10, { offset: 20 });
    assert.equal(later.some(row => row.id === old.id), true);
    assert.equal(later.some(row => first.some(item => item.id === row.id)), false);
    const filtered = await store.history('s', 10, { userId: 'a', action: 'profile' });
    assert.deepEqual(filtered.map(row => row.id), [old.id]);
    assert.deepEqual((await store.history('s', 10, { personId: initial.person.id, action: 'profile' })).map(row => row.id), [old.id]);
    assert.equal((await store.history('s', 10, { userId: 'missing' })).length, 0);
});

test('archiving a reviewed revision releases capacity and preserves audit and original sources', async t => {
    const { ctx, store } = await setup(t);
    const people = {}, links = {};
    let archivedId;
    for (let i = 0; i < 2000; i++) {
        const id = randomUUID(), userId = `u${i}`;
        people[id] = { id, name: userId, provisional: true, profile: '', evidence: [], locked: false, stale: false, revision: 1 };
        links[createHash('sha256').update(userId).digest('hex')] = { userId, name: userId, personId: id, confidence: 1, revision: 1 };
        if (!i) archivedId = id;
    }
    await ctx.database.create('person_memory.state', { scope: 's', revision: 1, state: { people, accounts: links, proposals: {}, settings: { mode: 'review', paused: false } } });
    await store.capture('s', { id: 'original', userId: 'u0', name: '原昵称', text: '原始消息', timestamp: 1234 });
    await assert.rejects(store.recognize('s', 'new', '新人'), /2000/);
    assert.equal(typeof store.archive, 'function', 'administrator archive operation must exist');
    await assert.rejects(store.archive('s', archivedId, actor, 0), /版本|过期/);
    await store.archive('s', archivedId, actor, 1);
    assert.equal(await store.find('s', 'u0'), undefined);
    assert.equal((await store.sources('s', 'u0'))[0].text, '原始消息');
    const archived = (await store.history('s'))[0];
    assert.equal(archived.action, 'archive');
    assert.equal(archived.changes.some(change => change.collection === 'people' && change.key === archivedId && change.before.id === archivedId), true);
    await store.recognize('s', 'new', '新人');
    assert.equal(Object.keys((await store.read('s')).accounts).length, 2000);
});

test('an archived account keeps its identity warning when rediscovered after source expiry and restart', async t => {
    const { ctx, store } = await setup(t);
    const old = await store.recognize('s', 'a', '甲');
    await store.setProfile('s', 'a', '旧画像', actor);
    const preview = await store.find('s', 'a');
    await store.archive('s', old.person.id, actor, preview.person.revision);
    await ctx.database.remove('person_memory.sources', { scope: 's' });
    const restarted = new PersonStore(ctx.database, 'review');
    const current = await restarted.recognize('s', 'a', '重新出现的甲');
    assert.notEqual(current.person.id, old.person.id);
    assert.equal(current.person.identityChanged, true);
    assert.equal(current.person.profile, '');
    assert.equal((await restarted.recognize('s', 'new', '新人')).person.identityChanged, undefined);
    assert.equal((await restarted.recognize('other', 'a', '别的群')).person.identityChanged, undefined);
});

test('identity correction remains visible after profile review, manual edit and undo', async t => {
    const { store } = await setup(t);
    await accounts(store);
    await store.setProfile('s', 'a', '旧印象', actor);
    await store.merge('s', 'a', 'b', actor);
    await store.split('s', 'a', '重新识别的甲', actor);
    assert.equal((await store.find('s', 'b')).person.identityChanged, true);
    await store.setProfile('s', 'b', '核实后的乙', actor);
    const edit = (await store.history('s'))[0];
    assert.equal((await store.find('s', 'b')).person.stale, false);
    await store.revert('s', edit.id, actor);
    assert.equal((await store.find('s', 'b')).person.identityChanged, true);
    await store.capture('s', { id: 'b1', userId: 'b', name: '乙', text: '我喜欢 Go', timestamp: 1235 });
    const candidate = await store.propose('s', 'b', '喜欢 Go', ['b1'], 'model');
    await store.review('s', candidate.id, true, actor);
    const current = (await store.find('s', 'b')).person;
    assert.equal(current.stale, false);
    assert.equal(current.identityChanged, true);
});

for (const operation of ['split', 'unbind']) test(`${operation} keeps the identity warning on the newly active person`, async t => {
    const { store } = await setup(t);
    const session = { platform: 'onebot', bot: { selfId: 'bot' }, channelId: 'g', userId: 'a' };
    const scope = load('store').sceneKey(session);
    await store.recognize(scope, 'a', '甲');
    await store.recognize(scope, 'b', '乙');
    await store.bind(scope, 'a', 'b', 0.9, actor);
    if (operation === 'split') await store.split(scope, 'a', '重新认出的甲', actor);
    else await store.unbind(scope, 'a', actor);
    await store.setProfile(scope, 'a', '核实后的独立画像', actor);
    const current = (await store.find(scope, 'a')).person;
    assert.equal(current.identityChanged, true);
    assert.equal(current.stale, false);
    const context = await renderPeople(store, { session });
    assert.match(context, /身份关联曾改变/);
    assert.match(context, /核实后的独立画像/);
});

test('identity link suggestions require scoped evidence and explicit admin acceptance even in auto mode', async t => {
    const { store } = await setup(t);
    const { source, target } = await accounts(store);
    await store.settings('s', { mode: 'auto' }, actor);
    assert.equal(typeof store.proposeLink, 'function', 'identity proposal operation must exist');
    const candidate = await store.proposeLink('s', 'a', target.person.id, 0.9, '账号自称是同一人', ['m'], 'main-model', versions(source, target));
    assert.equal(candidate.state, 'pending');
    assert.equal((await store.find('s', 'a')).person.id, source.person.id);
    assert.equal((await store.read('s')).linkProposals[candidate.id].evidence[0].userId, 'a');
    await store.review('s', candidate.id, true, actor);
    const bound = await store.find('s', 'a');
    assert.equal(bound.person.id, target.person.id);
    assert.equal(bound.accounts.find(a => a.userId === 'a').confidence, 0.9);
    assert.equal((await store.read('s')).linkProposals[candidate.id], undefined);
    await accounts(store, 'other');
    const other = await store.find('other', 'b');
    await assert.rejects(store.proposeLink('s', 'a', other.person.id, 0.8, '跨群猜测', ['m'], 'main-model', versions(bound, other)), /当前场景|不存在/);
});

test('stale identity link proposals cannot override a revised target or wrong-account evidence', async t => {
    const { store } = await setup(t);
    const { source, target } = await accounts(store);
    assert.equal(typeof store.proposeLink, 'function');
    await store.capture('s', { id: 'foreign', userId: 'b', name: '乙', text: '这不是甲的消息', timestamp: 1235 });
    await assert.rejects(store.proposeLink('s', 'a', target.person.id, 0.9, '错误证据', ['foreign'], 'main-model', versions(source, target)), /来源/);
    const candidate = await store.proposeLink('s', 'a', target.person.id, 0.9, '同人建议', ['m'], 'main-model', versions(source, target));
    await store.rename('s', 'b', '人工修订的乙', actor);
    await assert.rejects(store.review('s', candidate.id, true, actor), /过期/);
    assert.equal((await store.find('s', 'a')).person.id, source.person.id);
    await store.review('s', candidate.id, false, actor);
    assert.equal((await store.read('s')).linkProposals[candidate.id], undefined);
});

test('unload guards roll back recognition and source capture during awaited database writes', async t => {
    const { ctx, store } = await setup(t);
    await store.recognize('s', 'existing', '已有账号');
    for (const operation of ['recognize', 'capture']) {
        let active = true;
        const db = { transact: fn => ctx.database.transact(tx => fn(new Proxy(tx, {
            get(target, key) {
                if (key === 'create') return async (table, data) => {
                    const value = await target.create(table, data);
                    if (table === (operation === 'recognize' ? 'person_memory.audit' : 'person_memory.sources')) active = false;
                    return value;
                };
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }))) };
        const guarded = new PersonStore(db, 'review');
        const job = operation === 'recognize'
            ? guarded.recognize('s', 'cancelled', '卸载中的账号', () => active)
            : guarded.capture('s', { id: 'cancelled', userId: 'existing', name: '已有账号', text: '卸载中的消息', timestamp: 1234 }, () => active);
        await assert.rejects(job, /取消/);
    }
    assert.equal(await store.find('s', 'cancelled'), undefined);
    assert.equal((await store.sources('s', 'existing')).length, 0);
});

test('a full pending queue permits automatic profiles but still rejects new pending candidates', async t => {
    const { store } = await setup(t);
    const { target } = await accounts(store);
    for (let i = 0; i < 50; i++) {
        if (i % 2) {
            const source = await store.find('s', 'a');
            await store.proposeLink('s', 'a', target.person.id, 0.8, '等待人工核对', ['m'], 'model', versions(source, target));
        } else await store.propose('s', 'a', `待审画像${i}`, ['m'], 'model');
    }
    await assert.rejects(store.propose('s', 'a', '仍需审核的画像', ['m'], 'model'), /50/);
    await store.settings('s', { mode: 'auto' }, actor);
    const accepted = await store.propose('s', 'a', '自动接受的画像', ['m'], 'model');
    assert.equal(accepted.state, 'accepted');
    assert.equal((await store.find('s', 'a')).person.profile, '自动接受的画像');
    const state = await store.read('s');
    assert.equal(Object.keys(state.proposals).length + Object.keys(state.linkProposals).length, 50);
    await assert.rejects(store.proposeLink('s', 'a', target.person.id, 0.8, '仍需人工审核的关联', ['m'], 'model', versions(await store.find('s', 'a'), target)), /50/);
});
