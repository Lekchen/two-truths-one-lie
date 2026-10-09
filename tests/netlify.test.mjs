import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHandler} from '../lib/netlify-handler.mjs';

function mockBlobs(){
 const entries=new Map();let serial=0,conflicts=0;const seen=[];
 const fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url);const headers=new Headers(init.headers);const method=(init.method??'GET').toUpperCase();
  assert.equal(url.origin,'https://blobs-strong.invalid','All requests must bypass eventual-consistency storage.');
  const key=decodeURIComponent(url.pathname.split('/').at(-1));seen.push({method,key,match:headers.get('if-match'),fresh:headers.get('if-none-match')});
  if(method==='GET'){const entry=entries.get(key);return entry?new Response(JSON.stringify(entry.data),{headers:{etag:entry.etag,'Content-Type':'application/json'}}):new Response(null,{status:404});}
  assert.equal(method,'PUT');const match=headers.get('if-match'),fresh=headers.get('if-none-match');assert.ok(match||fresh,'Every write must be conditional.');const old=entries.get(key);
  if((fresh==='*'&&old)||(match&&(!old||old.etag!==match))){conflicts++;return new Response(null,{status:412});}
  const etag='"revision-'+(++serial)+'"';entries.set(key,{data:JSON.parse(init.body),etag});return new Response(null,{headers:{etag}});
 };
 return {fetch,entries,seen,get conflicts(){return conflicts}};
}
async function packaged(){const dir=await mkdtemp(join(tmpdir(),'netlify-game-'));execFileSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',resolve('function-artifacts/game.zip'),dir]);const {default:handler}=await import(pathToFileURL(join(dir,'netlify/functions/game.mjs')));return {handler,dir};}
const req=(b,headers={})=>new Request('https://game.netlify.app/.netlify/functions/game',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});

test('production packaged function: complete three rounds, scoring, final winner and concurrent updates',async()=>{
 const artifact=await packaged(),mock=mockBlobs(),originalFetch=globalThis.fetch,originalClock=Date.now,originalContext=globalThis.netlifyBlobsContext;let now=100000;
 globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify({siteID:'test-site',token:'test-only',edgeURL:'https://blobs-eventual.invalid',uncachedEdgeURL:'https://blobs-strong.invalid'})).toString('base64');globalThis.fetch=mock.fetch;Date.now=()=>now;
 const call=async(action,session={},extra={})=>{const response=await artifact.handler(req({...session,action,...extra}));const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data};
 try{
  const host=(await call('create',{}, {name:'Host',role:'player'})).session;
  const guest=(await call('join',{code:host.code},{name:'Guest',role:'player'})).session;
  await Promise.all([call('ready',host),call('ready',guest)]);
  assert.ok(mock.conflicts>0,'Simultaneous ready requests must cause a CAS conflict and successful retry.');
  const start=await call('start',host);assert.equal(start.state.phase,'write');assert.equal(start.state.members.every(p=>p.score===3),true);
  let final;
  for(let round=1;round<=3;round++){
   for(const author of [host,guest]){
    const guesser=author===host?guest:host;
    await call('submit',author,{statements:['Truth one','Truth two','Always the lie']});
    let s=(await call('poll',guesser)).state;assert.equal(s.phase,'countdown');assert.deepEqual(s.statements,[]);
    now+=3001;s=(await call('poll',guesser)).state;assert.equal(s.phase,'guess');assert.equal(s.round,round);assert.equal(s.lie,undefined);assert.equal(s.lieText,undefined);
    const repeat=(await call('poll',guesser)).state;assert.deepEqual(repeat.statements,s.statements,'Order survives separate function invocations.');
    now+=100;const choice=s.statements.indexOf(author===host?'Always the lie':'Truth one');final=(await call('vote',guesser,{choice})).state;
    assert.equal(final.myResult.delta,author===host?1:-1);assert.equal(final.members.find(p=>p.id===guesser.id).score,author===host?3+round:3-round);
    assert.equal(final.lieText,'Always the lie');assert.equal(final.rankings[0].id,guest.id);
    if(round===3&&author===guest){assert.equal(final.phase,'finished');break;}
    assert.equal(final.phase,'reveal');const next=(await call('next',host)).state;
    if(author===guest){assert.equal(next.phase,'roundEnd');assert.equal(next.rankings[0].score,3+round);await call('next',host);}else assert.equal(next.phase,'write');
   }
  }
  assert.equal(final.winner,guest.id);assert.equal(final.members.find(p=>p.id===host.id).score,0);assert.equal(final.members.find(p=>p.id===guest.id).score,6);
  assert.equal(final.rankings[0].stats.correct,3);assert.equal(final.rankings[1].stats.wrong,3);assert.equal(final.rankings[0].avgMs,101);
  assert.equal(JSON.stringify(final).includes(host.secret),false);assert.equal(JSON.stringify(final).includes(guest.secret),false);
  console.log('Verified three full rounds: Host 3→2→1→0; Guest 3→4→5→6. Winner: Guest.');
 }finally{globalThis.fetch=originalFetch;Date.now=originalClock;globalThis.netlifyBlobsContext=originalContext;await rm(artifact.dir,{recursive:true,force:true});}
});

test('stateless handler retries conflicts without discarding concurrent room changes',async()=>{
 let now=100000,etag=0,room,force=false,reads=0;
 const store={async setJSON(key,data,options){assert.ok(options.onlyIfNew||options.onlyIfMatch);if(force){force=false;room.notice='Concurrent change retained';etag++;return {modified:false};}if(options.onlyIfNew&&room)return {modified:false};if(options.onlyIfMatch&&options.onlyIfMatch!==String(etag))return {modified:false};room=structuredClone(data);return {modified:true,etag:String(++etag)};},async getWithMetadata(key,opts){assert.equal(opts.consistency,'strong');reads++;return {data:structuredClone(room),etag:String(etag)};}};
 const h=createHandler(()=>store,()=>now);const first=await (await h(req({action:'create',name:'Host',role:'player'}))).json();force=true;const r=await h(req({...first.session,action:'ready'}));assert.equal(r.status,200);assert.equal(room.members[0].ready,true);assert.equal(room.notice,'Concurrent change retained');assert.equal(reads,2);
});

test('security, errors and production package structure',async()=>{
 const h=createHandler(()=>{throw Error('Do not expose internal tokens')});assert.equal((await h(new Request('https://game.netlify.app/.netlify/functions/game'))).status,405);assert.equal((await h(req({action:'poll'},{origin:'https://other.example'}))).status,403);const r=await h(req({action:'create',name:'A',role:'player'}));assert.equal(r.status,503);assert.equal((await r.text()).includes('tokens'),false);
 const source=await readFile('netlify/functions/game.ts','utf8'),client=await readFile('dist/game.js','utf8'),toml=await readFile('netlify.toml','utf8');assert.match(source,/consistency: 'strong'/);assert.ok(!source.includes('config.path'));assert.ok(!toml.includes('redirect'));assert.ok(!client.includes('/api/game'));assert.ok(client.includes("fetch('/.netlify/functions/game'"));assert.deepEqual(await readdir('netlify/functions'),['game.ts']);
 const manifest=JSON.parse(await readFile('function-artifacts/manifest.json','utf8'));assert.equal(manifest.length,1);assert.equal(manifest[0].name,'game');assert.equal(manifest[0].runtime,'js');
});
