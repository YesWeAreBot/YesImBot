const test=require('node:test');
const assert=require('node:assert/strict');
const mock=require('@koishijs/plugin-mock').default;
const {load,fixture}=require('./helpers.cjs');
const plugin=load('index');
const {registerModels}=load('store');
const {buildSync}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
function coreListener() {
    const filename=path.resolve(__dirname,'../../core/src/services/worldstate/event-listener.ts');
    const result=buildSync({entryPoints:[filename],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
    const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);
    return mod.exports.EventListenerManager;
}
const EventListenerManager=coreListener();
const defaults={enabled:true,mode:'review',modelGroup:'',summaryThreshold:6,cooldownSeconds:600,timeoutSeconds:30,maxQueue:32};
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

for(const registration of ['before','after'])test(`real core stimulus sees first-message person and evidence with plugin registration ${registration} core`,async t=>{
    const tools=new Map(),observed=[];let injection,manager,world,personFork,mockFork;
    const app=await fixture(t,ctx=>{
        mockFork=ctx.plugin(mock);
        t.after(()=>{manager?.stop();personFork?.dispose();mockFork.dispose()});
        registerModels(ctx);
        ctx.model.extend('worldstate.system_events',{id:'string',payload:'json'},{primary:'id'});
        ctx.set('yesimbot.tool',{registerTool:tool=>tools.set(tool.name,tool),unregisterTool:name=>tools.delete(name)});
        ctx.set('yesimbot.prompt',{inject:(_name,_priority,fn)=>{injection=fn;return()=>{injection=undefined}}});
        world={isChannelAllowed:s=>s.channelId!=='blocked',recordMessage:async()=>{},recordSystemEvent:async()=>{}};
        ctx.set('yesimbot.world-state',world);
        ctx.set('yesimbot.logger',{getLogger:()=>({debug(){},info(){},error(){}})});
        ctx.set('yesimbot.asset',{transform:async content=>content});
        ctx.on('agent/stimulus',stimulus=>{
            observed.push((async()=>{
                const s=stimulus.session,tool=tools.get('person_memory');
                const read=await tool.execute({session:s,action:'read',account_id:s.userId});
                const prompt=await injection({session:s});
                const result=read.result;
                const proposal=await tool.execute({session:s,action:'propose',account_id:s.userId,profile:'本条消息立即可用',message_ids:[s.messageId],person_id:result?.id,person_revision:result?.revision,account_revision:result?.accounts[0].revision});
                return {read,prompt,proposal,userId:s.userId};
            })());
        });
    });
    manager=new EventListenerManager(app,world,{});
    if(registration==='before')personFork=app.plugin(plugin,defaults);
    manager.start();
    if(registration==='after')personFork=app.plugin(plugin,defaults);
    await app.mock.initUser('member',1);await app.mock.initUser('admin',3);await app.mock.initChannel('g');await app.mock.initChannel('blocked');
    await app.mock.client('member','g').receive('我喜欢 Python');
    assert.equal(observed.length,1);
    const first=await observed[0];assert.equal(first.read.status,'success');assert.ok(first.prompt.includes(first.read.result.id));assert.equal(first.proposal.status,'success');assert.equal(first.userId,'member');
    await app.mock.client('admin','g').receive('people.status');assert.equal(observed.length,1);
    await app.mock.client('member','blocked').receive('被过滤的消息');assert.equal(observed.length,1);
});
test('real Koishi parses history page filters and archive revision without consuming confirmation as text',async t=>{
    const tools=new Map();let adminSession,mockFork;
    const app=await fixture(t,ctx=>{
        mockFork=ctx.plugin(mock);t.after(()=>mockFork.dispose());
        ctx.set('yesimbot.tool',{registerTool:tool=>tools.set(tool.name,tool),unregisterTool:name=>tools.delete(name)});
        ctx.set('yesimbot.prompt',{inject:()=>()=>{}});
        ctx.set('yesimbot.world-state',{isChannelAllowed:()=>true});
        ctx.on('command/before-execute',argv=>{adminSession=argv.session;argv.session.__commandHandled=true});
        ctx.plugin(plugin,defaults);
    });
    await app.mock.initUser('admin',3);await app.mock.initChannel('g');const admin=app.mock.client('admin','g');
    const created=(await admin.receive('people.create 许仙')).join(''),id=created.match(/[0-9a-f-]{36}/)[0];
    for(let i=0;i<12;i++)await admin.receive(`people.edit ${id} 第${i}次画像`);
    const filtered=(await admin.receive(`people.history --page 2 --person ${id} --action profile`)).join('');assert.match(filtered,/第 2 页/);assert.equal((filtered.match(/#\d+ profile/g)||[]).length,2);
    assert.match((await admin.receive(`people.archive ${id}`)).join(''),/归档预览/);
    const read=(await tools.get('person_memory').execute({session:adminSession,action:'read',account_id:id})).result;
    assert.match((await admin.receive(`people.archive ${id} ${read.revision}`)).join(''),/已归档/);
    assert.equal((await tools.get('person_memory').execute({session:adminSession,action:'read',account_id:id})).status,'error');
});
