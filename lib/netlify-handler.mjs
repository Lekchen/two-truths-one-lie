import {createRoom, act, authenticate, view} from './game.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The store is supplied per invocation; no room state or locks live in process memory.
export function createHandler(storeFactory,clock=()=>Date.now()){
 return async function handle(request){
  if(request.method!=='POST')return reply({error:'Use POST.'},405);
  const origin=request.headers.get('origin');
  if(origin&&new URL(origin).origin!==new URL(request.url).origin)return reply({error:'Invalid origin.'},403);
  let body;try{const raw=await request.text();if(raw.length>10000)return reply({error:'Request too large.'},413);body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return reply({error:'Invalid JSON request.'},400)}
  try{
   const store=storeFactory();
   if(body.action==='create'){
    for(let attempt=0;attempt<10;attempt++){
     const now=clock(),room=createRoom(body.name,body.role,now);
     const written=await store.setJSON(room.code,room,{onlyIfNew:true});
     if(written.modified===true&&written.etag){const player=room.members[0];return reply({session:{code:room.code,id:player.id,secret:player.secret},state:view(room,player,now)});}
    }
    return reply({error:'Could not create a room. Please try again.'},409);
   }
   const code=String(body.code??'').trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))return reply({error:'Enter a six-character room code.'},400);
   for(let attempt=0;attempt<16;attempt++){
    // ETag and data come from the same strongly consistent read.
    const entry=await store.getWithMetadata(code,{type:'json',consistency:'strong'});
    if(!entry)return reply({error:'Room not found.'},404);
    if(!entry.etag)throw Error('Invalid storage response.');
    const room=entry.data,now=clock();let result;
    try{result=act(room,body,now);}catch(error){return reply({error:error.message},400);}
    const written=await store.setJSON(code,room,{onlyIfMatch:entry.etag});
    if(written.modified===true&&written.etag){
     if(result.left)return reply(result);
     const identity=body.action==='join'?result:body;
     const player=authenticate(room,identity);
     return reply({...(body.action==='join'?{session:result}:{}),state:view(room,player,now)});
    }
    // A conflict re-reads and re-applies the action to the latest room, never blind-writes.
    await pause(Math.min(5*(attempt+1),40));
   }
   return reply({error:'Room is busy. Please try again.'},409);
  }catch(error){
   if(/nickname|role/.test(error.message))return reply({error:error.message},400);
   return reply({error:'Room service is unavailable. Please try again shortly.'},503);
  }
 };
}
