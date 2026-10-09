import assert from 'node:assert/strict';
import {createRoom,act,view,tick} from '../lib/game.mjs';
let now=100000;
const session=p=>({id:p.id,secret:p.secret});
const action=(r,p,action,extra={})=>act(r,{...session(p),action,...extra},now);
const join=(r,name,role='player')=>{act(r,{action:'join',name,role},now);return r.members.at(-1)};
function setup(count=3,points=3){const r=createRoom('Host','player',now);for(let i=1;i<count;i++)join(r,'Player'+i);action(r,r.members[0],'settings',{points,guessSeconds:30});for(const p of r.members)action(r,p,'ready');action(r,r.members[0],'start');return r;}
function startGuess(r){const p=r.members.find(p=>p.id===r.author);action(r,p,'submit',{statements:['I own a cat','I enjoy rice','I live on Mars']});assert.equal(r.phase,'countdown');assert.deepEqual(view(r,p,now).statements,[]);assert.throws(()=>action(r,r.members.find(x=>x.id!==p.id),'vote',{choice:0}));now+=3000;tick(r,now);assert.equal(r.phase,'guess');}
function answer(r,p,correct){const s=view(r,p,now);action(r,p,'vote',{choice:correct?s.lie??s.statements.indexOf('I live on Mars'):s.statements.indexOf('I own a cat')});}
let r=setup();const [h,a,b]=r.members;
assert.equal(r.settings.points,3);assert.throws(()=>action(r,h,'settings',{points:2,guessSeconds:30}));
assert.throws(()=>action(r,h,'submit',{statements:[' same ','SAME','different']}));
action(r,h,'extend');assert.equal(r.extended,true);assert.throws(()=>action(r,h,'extend'));assert.match(r.notice,/30 more/);
startGuess(r);const order=view(r,a,now).statements;assert.deepEqual(view(r,a,now+20).statements,order);assert.equal(view(r,a,now).lie,undefined);assert.equal(view(r,a,now).lieText,undefined);assert.ok(!JSON.stringify(view(r,a,now)).includes(a.secret));
assert.throws(()=>action(r,h,'vote',{choice:0}));now+=500;answer(r,a,true);assert.equal(view(r,b,now).myVote,undefined);assert.throws(()=>answer(r,a,false));assert.throws(()=>action(r,b,'chat',{text:'Hint'}));assert.throws(()=>action(r,b,'react',{emoji:'😂'}));answer(r,b,false);assert.equal(r.phase,'reveal');assert.equal(a.score,4);assert.equal(b.score,2);assert.equal(view(r,a,now).statements[view(r,a,now).lie],'I live on Mars');
action(r,a,'react',{emoji:'😂'});assert.throws(()=>action(r,a,'react',{emoji:'👏'}));now+=2000;action(r,a,'react',{emoji:'👏'});action(r,a,'chat',{text:'Nice round'});assert.throws(()=>action(r,a,'chat',{text:'spam'}));action(r,h,'mute',{target:a.id});now+=2000;assert.throws(()=>action(r,a,'chat',{text:'blocked'}));
action(r,h,'cohost',{target:a.id});action(r,a,'next');startGuess(r);action(r,h,'vote',{choice:null});assert.equal(h.skips,1);answer(r,b,true);assert.equal(h.skips,0);action(r,a,'next');startGuess(r);assert.throws(()=>action(r,h,'vote',{choice:null}));now+=31000;tick(r,now);assert.equal(h.score,2);assert.equal(r.results.find(x=>x.id===h.id).type,'missed');assert.equal(r.results.find(x=>x.id===h.id).delta,-1);action(r,a,'next');assert.equal(r.phase,'roundEnd');assert.ok(view(r,h,now).rankings.length===3);action(r,a,'next');assert.equal(r.round,2);assert.equal(h.skips,1);
// Score tie uses correct response times.
a.score=4;b.score=4;a.stats={correct:2,wrong:0,skipped:0,missed:0,correctMs:8000};b.stats={correct:2,wrong:0,skipped:0,missed:0,correctMs:4000};assert.ok(view(r,h,now).rankings.find(x=>x.id===b.id).rank<view(r,h,now).rankings.find(x=>x.id===a.id).rank);
// Capacity, readiness, requests, co-host actions, leave transfer.
r=createRoom('Host','player',now);const host=r.members[0];for(let i=1;i<8;i++)join(r,'P'+i);assert.throws(()=>join(r,'Extra'));const v=join(r,'Viewer','viewer');const v2=join(r,'Viewer2','viewer');assert.equal(view(r,host,now).locked,true);assert.throws(()=>join(r,'Eleven','viewer'));assert.throws(()=>action(r,host,'role',{target:r.members[1].id,role:'viewer'}));
action(r,host,'kick',{target:r.members[1].id});assert.equal(view(r,host,now).locked,false);assert.throws(()=>action(r,host,'role',{target:v.id,role:'player'}));action(r,v,'request');action(r,host,'role',{target:v.id,role:'player'});assert.equal(v.role,'player');action(r,host,'lock');assert.throws(()=>join(r,'Blocked','viewer'));action(r,host,'lock');action(r,host,'cohost',{target:v2.id});action(r,host,'leave');assert.equal(r.host,v2.id);
r=setup(2,6);assert.equal(r.members[0].skips,2);const spectator=join(r,'Spectator','viewer');assert.throws(()=>action(r,spectator,'submit',{statements:['a','b','c']}));assert.throws(()=>action(r,spectator,'vote',{choice:0}));const host2=r.members[0];action(r,host2,'cohost',{target:spectator.id});host2.seen=now-31000;tick(r,now);assert.equal(r.host,spectator.id);
// Timeout extension and automatic next presenter.
r=setup(3);const first=r.author;action(r,r.members[0],'extend');now+=90001;tick(r,now);assert.equal(r.author,first);now+=30000;tick(r,now);assert.notEqual(r.author,first);
// Away >3 rounds: viewer promotion or removal if viewer seats are full.
r=setup(3);let away=r.members[2];action(r,away,'away');r.phase='roundEnd';for(let i=0;i<4;i++){action(r,r.members[0],'next');r.phase='roundEnd';}assert.equal(away.role,'viewer');
r=setup(3);join(r,'V1','viewer');join(r,'V2','viewer');away=r.members[2];action(r,away,'away');for(let i=0;i<4;i++){r.phase='roundEnd';action(r,r.members[0],'next');}assert.ok(!r.members.some(p=>p.id===away.id));
// Winner, replay, permission enforcement.
r=setup(2);let loser=r.members[1];loser.score=1;startGuess(r);answer(r,loser,false);assert.equal(r.phase,'finished');assert.equal(r.winner,r.members[0].id);assert.equal(view(r,r.members[0],now).rankings[0].id,r.winner);assert.throws(()=>action(r,loser,'restart'));action(r,r.members[0],'restart');assert.equal(r.phase,'lobby');assert.equal(r.members.every(p=>!p.ready),true);
console.log('PASS: scoring, skip budgets, missed penalties, countdown, presenter timeout, extension, privacy, stable orders, ranking, readiness, capacity, viewer promotion, spectators, co-host permissions, transfer, chat, reaction rates, away demotion/removal, victory and replay.');
