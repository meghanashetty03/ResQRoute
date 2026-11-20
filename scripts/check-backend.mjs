import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const directories=[new URL('../backend/',import.meta.url),new URL('../shared/',import.meta.url)];
let count=0;
function check(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    if(entry.name==='node_modules')continue;
    const url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
    if(entry.isDirectory())check(url);
    else if(entry.name.endsWith('.js')) {
      const result=spawnSync(process.execPath,['--check',fileURLToPath(url)],{stdio:'inherit',windowsHide:true});
      if(result.error)throw result.error;
      if(result.status!==0)process.exit(result.status||1);
      count++;
    }
  }
}
directories.forEach(check);
console.log(`Syntax checked ${count} backend/shared JavaScript files.`);
