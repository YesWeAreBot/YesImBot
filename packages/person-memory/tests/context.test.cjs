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
