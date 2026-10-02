import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readQuizDraft, writeQuizDraft, QUIZ_DRAFT_KEY } from '../src/utils/quiz-draft.ts';
import { scoreQuiz } from '../src/utils/scoring.ts';
const now = 1000000000;
const form = {name:'Test Rowan',birthMonth:'4',birthDay:'12',birthYear:'1990',email:'',belonging:0,intensity:1,nightSky:2,dreams:1,recharge:0,empathy:1,soulAge:2};
function memory() { const m = new Map(); return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}; }
for (const shadow of [false,true]) test(`checkout return/refresh preserves completed answers and bump=${shadow}`,()=>{
 const s=memory();writeQuizDraft(s,{step:'reveal',form,addShadowOrigin:shadow},now);
 const restored=readQuizDraft(s,now+1); assert.deepEqual(restored,{step:'reveal',form,addShadowOrigin:shadow});
 const score=f=>scoreQuiz({...f,birthMonth:Number(f.birthMonth),birthDay:Number(f.birthDay)});
 assert.deepEqual(score(restored.form),score(form));
});
test('partial progress and interrupted animation recover',()=>{
 const s=memory();writeQuizDraft(s,{step:'intensity',form:{...form,intensity:null},addShadowOrigin:false},now);
 assert.equal(readQuizDraft(s,now).step,'intensity');
 writeQuizDraft(s,{step:'reading',form,addShadowOrigin:false},now);assert.equal(readQuizDraft(s,now).step,'reveal');
});
test('reject malformed, expired, future, incomplete and out-of-range drafts',()=>{
 const s=memory(); for(const value of ['bad','null',JSON.stringify({version:2})]){s.setItem(QUIZ_DRAFT_KEY,value);assert.equal(readQuizDraft(s,now),null);}
 for(const date of [now-86400000,now+1]){writeQuizDraft(s,{step:'reveal',form,addShadowOrigin:false},date);assert.equal(readQuizDraft(s,now),null);}
 for(const changed of [{belonging:null},{empathy:3},{birthMonth:'13'},{birthDay:'0'},{name:''}]){writeQuizDraft(s,{step:'reveal',form:{...form,...changed},addShadowOrigin:false},now);assert.equal(readQuizDraft(s,now),null);}
});
test('blocked storage does not throw',()=>{
 const s={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
 assert.equal(readQuizDraft(s),null);assert.equal(writeQuizDraft(s,{step:'reveal',form,addShadowOrigin:false}),false);
});
