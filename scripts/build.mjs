import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {zipFunctions} from '@netlify/zip-it-and-ship-it';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('frontend','dist',{recursive:true});
// Preserve old direct game.html links as well as the root page.
await cp('frontend/index.html','dist/game.html');
await rm('function-artifacts',{recursive:true,force:true});
await mkdir('function-artifacts',{recursive:true});
const functions=await zipFunctions('netlify/functions','function-artifacts',{
 config:{'*':{nodeBundler:'esbuild',nodeVersion:'22'}},
 archiveFormat:'zip',
});
if(functions.length!==1||functions[0].name!=='game')throw Error('Expected exactly one packaged function named game.');
// Keep the portable record separate from caches and local machine-specific paths.
await writeFile('function-artifacts/manifest.json',JSON.stringify(functions.map(({name,runtime,entryFilename})=>({name,runtime,entryFilename})),null,2));
console.log('Production frontend built; standard game function packaged at function-artifacts/game.zip.');
