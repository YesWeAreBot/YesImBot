const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const path = require('node:path');
const Module = require('node:module');

const entry = path.join(__dirname, '../src/index.ts');
const code = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['koishi'] }).outputFiles[0].text;
const compiled = new Module(entry, module); compiled.filename = entry; compiled.paths = module.paths;
compiled._compile(code, entry);
const plugin = compiled.exports;

function setup(config = {}) {
  const tables = { 'yesimbot.onebot_directory_snapshots': [], 'yesimbot.onebot_directory_contacts': [] };
  let tool;
  const activity = { models: 0, commands: 0 };
  const ctx = {
    model: { extend() { activity.models++; } }, logger: { warn() {} }, on() {},
    'yesimbot.tool': { registerTool(item) { tool = item; }, unregisterTool() {} },
    command() { activity.commands++; return { option() { return this; }, action() { return this; } }; },
    database: {
      async get(table, q, opt = {}) {
        let data = tables[table].filter(x => Object.entries(q).every(([k,v]) => typeof v === 'object' ? ('$nin' in v ? !v.$nin.includes(x[k]) : x[k] !== v.$ne) : x[k] === v));
        if (opt.sort) data = data.sort((a,b) => a.ordinal - b.ordinal);
        return data.slice(opt.offset ?? 0, (opt.offset ?? 0) + (opt.limit ?? Infinity)).map(x => ({ ...x }));
      },
      async upsert(table, batch) {
        for (const row of batch) {
          const keys = table.endsWith('_snapshots') ? ['platform','ownerId','scope'] : ['platform','ownerId','scope','revision','userId'];
          const ix = tables[table].findIndex(x => keys.every(k => x[k] === row[k]));
          if (ix === -1) tables[table].push({ ...row }); else tables[table][ix] = { ...row };
        }
      },
      async remove(table, q) { tables[table] = tables[table].filter(x => Object.entries(q).some(([k,v]) => typeof v === 'object' ? ('$nin' in v ? v.$nin.includes(x[k]) : x[k] === v.$ne) : x[k] !== v)); },
    },
  };
  plugin.apply(ctx, { enabled: true, concurrency: 2, batchSize: 100, ...config });
  const session = { platform: 'onebot', channelId: 'g', guildId: 'g', isDirect: false,
    bot: { platform: 'onebot', selfId: 'bot1', internal: {
      async getFriendList() { return []; },
      async getGroupMemberList() { return Array.from({ length: 2005 }, (_,i) => ({ user_id: i+1, nickname: `User ${i+1}` })); },
    } },
  };
  return { tool, session, activity };
}

test('model gets only count, exact lookup or bounded page; all/refresh are ignored', async () => {
  const { tool, session } = setup();
  assert.equal('all' in tool.parameters.dict, false);
  assert.equal('refresh' in tool.parameters.dict, false);
  const count = await tool.execute({ session, kind: 'members', mode: 'count' });
  assert.equal(count.result.total, 2005);
  assert.equal(count.result.entries.length, 0);
  const page = await tool.execute({ session, kind: 'members', mode: 'page', limit: 20, all: true, refresh: true });
  assert.equal(page.result.entries.length, 20);
  const lookup = await tool.execute({ session, kind: 'members', mode: 'lookup', user_id: '2005' });
  assert.deepEqual(lookup.result.entries.map(x => x.userId), ['2005']);
  const tooLarge = await tool.execute({ session, kind: 'members', mode: 'page', limit: 2005 });
  assert.equal(tooLarge.status, 'error');
});

test('repeated model pages stop after a bounded number of entries', async () => {
  const { tool, session } = setup();
  for (let offset = 0; offset < 80; offset += 20) {
    const response = await tool.execute({ session, kind: 'members', mode: 'page', offset, limit: 20 });
    assert.equal(response.result.entries.length, 20);
  }
  const blocked = await tool.execute({ session, kind: 'members', mode: 'page', offset: 80, limit: 20 });
  assert.equal(blocked.status, 'error');
});

test('concurrent model pages reserve the same shared budget', async () => {
  const { tool, session } = setup();
  const results = await Promise.all(Array.from({ length: 10 }, (_,i) =>
    tool.execute({ session, kind: 'members', mode: 'page', offset: i*20, limit: 20 })));
  assert.equal(results.filter(x => x.status === 'success').reduce((n,x) => n + x.result.entries.length, 0), 80);
  assert.equal(results.filter(x => x.status === 'error').length, 6);
});

test('model cannot cross group boundaries or read friends from a public group', async () => {
  const { tool, session } = setup();
  const crossGroup = await tool.execute({ session, kind: 'members', mode: 'count', group_id: 'other' });
  const friends = await tool.execute({ session, kind: 'friends', mode: 'count' });
  assert.equal(crossGroup.status, 'error');
  assert.equal(friends.status, 'error');
});

test('private administrator can query, while an unverified private user is denied', async () => {
  const { tool, session } = setup();
  session.isDirect = true; session.guildId = undefined; session.channelId = 'private';
  session.observeUser = async () => ({ authority: 1 });
  const denied = await tool.execute({ session, kind: 'members', mode: 'count', group_id: 'g' });
  assert.equal(denied.status, 'error');
  session.observeUser = async () => ({ authority: 3 });
  const allowed = await tool.execute({ session, kind: 'members', mode: 'count', group_id: 'g' });
  assert.equal(allowed.status, 'success');
  const friends = await tool.execute({ session, kind: 'friends', mode: 'count' });
  assert.equal(friends.status, 'success');
});


test('disabled plugin registers no tables, tool or commands', () => {
  const { tool, activity } = setup({ enabled: false });
  assert.equal(tool, undefined);
  assert.equal(activity.models, 0);
  assert.equal(activity.commands, 0);
});
