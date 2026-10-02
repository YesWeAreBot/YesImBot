const test = require('node:test');
const assert = require('node:assert/strict');
const {load,fixture}=require('./helpers.cjs');
const {PersonStore,registerModels,sceneKey}=load('store');
const {renderPeople}=load('context');
const session={platform:'onebot',bot:{selfId:'b'},channelId:'g',userId:'u1',isDirect:false};
test('only active current-scene people are rendered; stale profile withheld and text escaped',async t=>{
    const ctx=await fixture(t,registerModels), store=new PersonStore(ctx.database,'review');
    const scope=sceneKey(session);
    await store.recognize(scope,'u1','{{bot.id}} <evil>');
    await store.recognize(scope,'u2','其他');
    await store.recognize('different','u1','SECRET');
    await store.setProfile(scope,'u1','喜欢 <code> {{user.name}}','admin');
    let result=await renderPeople(store,{session,WORLD_STATE:{l1_working_memory:{new_events:[],processed_events:[]}}});
    assert.match(result,/喜欢 &lt;code&gt;/);
    assert.equal(result.includes('{{'),false);
    assert.equal(result.includes('SECRET'),false);
    assert.equal(result.includes('其他'),false);
    await store.bind(scope,'u1','u2',0.8,'admin');
    result=await renderPeople(store,{session});
    assert.equal(result.includes('喜欢'),false);
});
test('no session gives no injection; current sender included even absent from L1; output bounded',async t=>{
    const ctx=await fixture(t,registerModels),store=new PersonStore(ctx.database,'review');
    assert.equal(await renderPeople(store,{}),'');
    const scope=sceneKey(session);
    for(let i=1;i<=10;i++) { await store.recognize(scope,`u${i}`,`人物${i}`);await store.setProfile(scope,`u${i}`,'甲'.repeat(2000),'admin'); }
    const view={session,WORLD_STATE:{l1_working_memory:{new_events:Array.from({length:10},(_,i)=>({type:'message',sender:{id:`u${i+1}`}}))}}};
    const result=await renderPeople(store,view);
    assert.ok(result.length<=6000);
    assert.match(result,/人物1/);
    assert.ok((result.match(/<person /g)||[]).length<=6);
});

test('identity warning survives cleared stale state and related link candidates render for source and target only',async t=>{
    const ctx=await fixture(t,registerModels),store=new PersonStore(ctx.database,'review'),scope=sceneKey(session);
    const source=await store.recognize(scope,'u1','来源'),target=await store.recognize(scope,'u2','目标');
    await store.bind(scope,'u1','u2',0.8,'admin');await store.setProfile(scope,'u2','最新画像','admin');
    let result=await renderPeople(store,{session});assert.match(result,/identity_changed="true"/);assert.match(result,/身份关联曾改变/);assert.match(result,/最新画像/);
    await store.unbind(scope,'u1','admin');await store.capture(scope,{id:'e',userId:'u1',name:'来源',text:'关联依据',timestamp:Date.now()});
    const a=await store.find(scope,'u1'),b=await store.find(scope,'u2');
    const proposed=await store.proposeLink(scope,'u1',b.person.id,0.7,'关联依据',['e'],'model',{personId:a.person.id,personRevision:a.person.revision,accountRevision:a.accounts[0].revision,targetRevision:b.person.revision});
    for(const userId of ['u1','u2'])assert.match(await renderPeople(store,{session:{...session,userId}}),new RegExp(proposed.id));
    await store.recognize(scope,'u3','无关人物');assert.equal((await renderPeople(store,{session:{...session,userId:'u3'}})).includes(proposed.id),false);
});
