const test=require('node:test');
const assert=require('node:assert/strict');
const mock=require('@koishijs/plugin-mock').default;
const {load,fixture}=require('./helpers.cjs');
const plugin=load('index');
test('real Koishi lifecycle, command parser and authority gate operate with SQLite',async t=>{
    const tools=new Map();let injection,mockFork;
    const app=await fixture(t,ctx=>{
        mockFork=ctx.plugin(mock);
        ctx.set('yesimbot.tool',{registerTool:tool=>tools.set(tool.name,tool),unregisterTool:name=>tools.delete(name)});
        ctx.set('yesimbot.prompt',{inject:(_name,_priority,fn)=>{injection=fn;return()=>{injection=undefined}}});
        ctx.set('yesimbot.world-state',{isChannelAllowed:()=>true});
        // Equivalent to core's command handling marker; command dispatch itself is real Koishi.
        ctx.on('command/before-execute',argv=>{argv.session.__commandHandled=true});
        ctx.plugin(plugin,{enabled:true,mode:'review',modelGroup:'',summaryThreshold:6,cooldownSeconds:600,timeoutSeconds:30,maxQueue:32});
    });
    await app.mock.initUser('admin',3);await app.mock.initUser('member',1);await app.mock.initChannel('g');
    const admin=app.mock.client('admin','g'),member=app.mock.client('member','g');
    const denied=await member.receive('people.create 禁止');assert.ok(!denied.join('').includes('已创建'));
    const created=await admin.receive('people.create 许仙');const id=created.join('').match(/[0-9a-f-]{36}/)?.[0];assert.ok(id,created.join(''));
    assert.match((await admin.receive(`people.bind member ${id} 0.9`)).join(''),/已关联/);
    assert.match((await admin.receive('people.show member')).join(''),/许仙/);
    assert.match((await admin.receive('people.edit member 喜欢 Python')).join(''),/喜欢 Python/);
    assert.match((await admin.receive('people.lock member')).join(''),/锁定/);
    assert.match((await admin.receive('people.status')).join(''),/review/);
    assert.ok(tools.has('person_memory'));assert.equal(typeof injection,'function');
    mockFork.dispose();await app.stop();assert.equal(tools.size,0);assert.equal(injection,undefined);
});
