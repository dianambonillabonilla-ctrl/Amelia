const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.join(__dirname,'..');
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.gs'))){new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});}
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ids=[...index.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw new Error('Hay IDs HTML duplicados');
const script=fs.readFileSync(path.join(root,'scripts.html'),'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');new vm.Script(script,{filename:'scripts.html'});
console.log(`Validación correcta: ${ids.length} IDs únicos y sintaxis válida.`);
