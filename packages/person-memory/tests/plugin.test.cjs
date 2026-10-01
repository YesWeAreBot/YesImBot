const test=require('node:test');
const assert=require('node:assert/strict');
const {load,fixture}=require('./helpers.cjs');
const {apply}=load('index');
const {registerModels}=load('store');
const defaults={enabled:true,mode:'review',modelGroup:'',summaryThreshold:6,cooldownSeconds:600,timeoutSeconds:30,maxQueue:32};
const session=(extra={})=>({platform:'onebot',bot:{selfId:'b'},channelId:'g',userId:'u',isDirect:false,author:{name:'群友'},content:'喜欢 Python',messageId:'m',timestamp:Date.now(),user:{authority:3},...extra});
async function setup(t,config={}) {
    const tools=new Map(),commands=new Map(),hooks=new Map();
    let injection,middleware,disposed=false;
    const ctx=await fixture(t,registerModels);
    {
        // External YIB services and Koishi command dispatch only; DB remains actual SQLite.
        const facade={model:ctx.model,database:ctx.database};
        facade['yesimbot.tool']={registerTool:tool=>tools.set(tool.name,tool),unregisterTool:name=>tools.delete(name)};
        facade['yesimbot.prompt']={inject:(_name,_priority,fn)=>{injection=fn;return()=>{disposed=true;injection=undefined}}};
        facade['yesimbot.world-state']={isChannelAllowed:s=>s.channelId!=='blocked'};
        facade.command=(name,description,options)=>{ const spec={name,description,options,action:null};commands.set(name.split(' ')[0],spec);const chain={option:()=>chain,action:fn=>{spec.action=fn;return chain}};return chain; };
        facade.on=(name,fn)=>{hooks.set(name,fn)};
        facade.middleware=fn=>{middleware=fn};
        facade.logger=()=>({warn(){},error(){},info(){}});
        apply(facade,{...defaults,...config});
    }
    async function command(name,s,...args){return commands.get(name).action({session:s,options:{}},...args)}
    return {ctx,tools,commands,hooks,command,get injection(){return injection},get middleware(){return middleware},get disposed(){return disposed}};
}
test('disabled plugin has no registrations; all lifecycle commands require authority 3',async t=>{
    const off=await setup(t,{enabled:false});assert.equal(off.tools.size,0);assert.equal(off.commands.size,0);
    const f=await setup(t);
    for(const cmd of f.commands.values()) assert.equal(cmd.options.authority,3);
    for(const name of ['people.status','people.show','people.sources','people.create','people.bind','people.unbind','people.merge','people.split','people.edit','people.lock','people.unlock','people.pending','people.approve','people.reject','people.history','people.revert','people.pause','people.resume','people.mode','people.summarize'])assert.ok(f.commands.has(name),name);
    const denied=await f.command('people.create',session({user:{authority:1}}),'不可创建');
    assert.match(denied,/管理员/);
});
test('capture skips bots, blocked scenes and commands; current account is injected without changing sender',async t=>{
    const f=await setup(t),s=session();
    await f.middleware(s,async()=>{});
    const ctx=await f.injection({session:s});assert.match(ctx,/群友/);
    assert.equal(s.userId,'u');assert.equal(s.author.name,'群友');
    const tool=f.tools.get('person_memory');
    const own=await tool.execute({session:s,action:'read',account_id:'u'});assert.equal(own.status,'success');
    assert.equal((await tool.execute({session:session({channelId:'other'}),action:'read',account_id:'u'})).status,'error');
    for(const input of [session({channelId:'blocked'}),session({userId:'bot-user',author:{isBot:true}}),session({userId:'cmd-user',__commandHandled:true})])await f.middleware(input,async()=>{});
    assert.equal((await tool.execute({session:s,action:'read',account_id:'bot-user'})).status,'error');
    assert.equal((await tool.execute({session:s,action:'read',account_id:'cmd-user'})).status,'error');
});
test('model can only propose; admin reviews/locks; scoped tools cannot rebind or approve',async t=>{
    const f=await setup(t),s=session();await f.middleware(s,async()=>{});
    const tool=f.tools.get('person_memory');
    const initial=await tool.execute({session:s,action:'read',account_id:'u'});
    const versions={person_id:initial.result.id,person_revision:initial.result.revision,account_revision:initial.result.accounts[0].revision};
    const proposal=await tool.execute({session:s,action:'propose',account_id:'u',profile:'喜欢 Python',message_ids:['m'],...versions});
    assert.equal(proposal.status,'success');
    let read=await tool.execute({session:s,action:'read',account_id:'u'});assert.equal(read.result.profile,'');
    assert.equal((await tool.execute({session:s,action:'bind',account_id:'u'})).status,'error');
    assert.equal((await tool.execute({session:s,action:'approve',proposal_id:proposal.result.id})).status,'error');
    assert.match(await f.command('people.approve',s,proposal.result.id),/已接受/);
    assert.match(await f.command('people.lock',s,'u'),/锁定/);
    assert.equal((await tool.execute({session:s,action:'propose',account_id:'u',profile:'替换',['message_ids']:['m']})).status,'error');
    assert.equal((await tool.execute({session:session({channelId:'blocked'}),action:'read',account_id:'u'})).status,'error');
});
test('a main model proposal based on stale context cannot overwrite a manual edit in auto mode',async t=>{
    const f=await setup(t,{mode:'auto'}),s=session();await f.middleware(s,async()=>{});
    const tool=f.tools.get('person_memory');
    const initial=(await tool.execute({session:s,action:'read',account_id:'u'})).result;
    await f.command('people.edit',s,'u','人工新画像');
    const proposal=await tool.execute({session:s,action:'propose',account_id:'u',profile:'旧模型画像',message_ids:['m'],person_id:initial.id,person_revision:initial.revision,account_revision:initial.accounts[0].revision});
    assert.equal(proposal.status,'error');
    assert.equal((await tool.execute({session:s,action:'read',account_id:'u'})).result.profile,'人工新画像');
});
test('create, bind, split, mode and pause work; unload removes tools and injection',async t=>{
    const f=await setup(t),s=session();await f.middleware(s,async()=>{});
    const created=await f.command('people.create',s,'许仙');const id=created.match(/[0-9a-f-]{36}/)[0];
    assert.match(await f.command('people.bind',s,'u',id,0.9),/已关联/);
    assert.match(await f.command('people.show',s,'u'),/许仙/);
    assert.match(await f.command('people.split',s,'u','另一个人'),/已拆分/);
    assert.match(await f.command('people.mode',s,'auto'),/auto/);
    assert.match(await f.command('people.pause',s),/暂停/);
    assert.equal((await f.tools.get('person_memory').execute({session:s,action:'propose',account_id:'u',profile:'新',['message_ids']:['m']})).status,'error');
    await f.hooks.get('dispose')();assert.equal(f.tools.size,0);assert.equal(f.disposed,true);
});
