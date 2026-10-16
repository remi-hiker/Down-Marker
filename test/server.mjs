import http from 'node:http';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['test/harness.ts'],bundle:true,format:'esm',platform:'browser',outfile:'dist/test/harness.js'});
http.createServer(async (req,res) => {
  if (req.url === '/harness.js') {res.setHeader('Content-Type','text/javascript'); res.end(await fs.readFile('dist/test/harness.js'));}
  else { res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script type="module" src="/harness.js"></script></body></html>'); }
}).listen(4179,'127.0.0.1');
