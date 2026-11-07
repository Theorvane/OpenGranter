import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManagementBrowser } from './build-management-browser.ts';

// Opt-in synthetic UI preview only. Never composed into the production gateway.
export async function startCatalogPreview(port = 18776) {
  const app = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/catalog-app.ts',
  });
  const entry = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/catalog-entry.ts',
  });
  const server = createServer((req, res) => {
    const path = req.url;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const files: Record<string, [string, string]> = {
      '/app.js': ['text/javascript', app],
      '/entry.js': ['text/javascript', entry],
      '/preview.js': ['text/javascript', previewCode],
      '/': ['text/html', shell(false)],
      '/signed-out': ['text/html', shell(true)],
      '/away': [
        'text/html',
        '<!doctype html><title>Navigation test</title><h1>Navigation test</h1><p>Use browser Back to test restoration.</p>',
      ],
    };
    const file = files[path ?? ''];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', `${file[0]}; charset=utf-8`);
    res.end(file[1]);
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return server;
}

const previewCode = `import {mountManagementCatalog} from './app.js';
const root = document.getElementById('app');
let app = mountManagementCatalog(root);
const models = [
  {id:'demo/atlas-chat',object:'model',created:1735689600,owned_by:'OpenGranter Demo'},
  {id:'demo/aurora-code',object:'model',created:1735776000,owned_by:'Example Labs'},
  {id:'demo/ember-small',object:'model',created:1735862400,owned_by:'OpenGranter Demo'},
];
let generation = 0;
async function show(mode) {
  const current = ++generation;
  document.getElementById('scenario').textContent = 'Demo scenario: ' + mode;
  await app.authorize({expiresAt:Date.now()+3600000,request:async(path)=>{
    await new Promise(resolve=>setTimeout(resolve,mode==='loading'?3000:180));
    if(current!==generation) return new Response('',{status:503});
    if(mode==='error') return new Response('',{status:503});
    if(path==='/api/v1/models') return Response.json({object:'list',data:mode==='empty'?[]:models});
    const id = decodeURIComponent(path.slice('/api/v1/models/'.length));
    const model = models.find(model=>model.id===id);
    return model ? Response.json(model) : new Response('',{status:404});
  }});
}
for(const mode of ['list','loading','empty','error']) document.getElementById(mode).onclick=()=>show(mode);
window.addEventListener('pagehide',()=>{generation++;app.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted){app=mountManagementCatalog(root);document.getElementById('scenario').textContent='Restored signed-out — select a demo scenario to continue.';}});
show('list');`;

function shell(signedOut: boolean) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGranter — disconnected preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#17233b;font:16px/1.55 system-ui,sans-serif}header{background:#152540;color:white;padding:22px max(24px,calc((100vw - 1100px)/2));display:flex;justify-content:space-between;align-items:center;gap:16px}header strong{font-size:22px;letter-spacing:-.5px}header span{font-size:13px;color:#bed0ef}.layout{max-width:1100px;margin:32px auto;padding:0 24px}.notice{border:1px solid #e7c571;background:#fff7dd;border-radius:10px;padding:16px 20px;color:#694d13}.notice strong{display:block}nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 12px}button,a{font:inherit}button{cursor:pointer;background:white;color:#243c63;border:1px solid #bdcbe0;border-radius:8px;padding:10px 16px}button:hover{background:#eef3fc;border-color:#5776a6}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #4778df;outline-offset:3px}#scenario{color:#51617c;font-size:14px;margin-bottom:18px}main{background:white;border:1px solid #e0e6ef;border-radius:14px;padding:30px;box-shadow:0 8px 26px #20365708}h1{font-size:26px;line-height:1.3;margin:0 0 24px;letter-spacing:-.6px}label{display:block;font-size:14px;font-weight:600}input{display:block;width:100%;font:inherit;border:1px solid #bdcbe0;border-radius:8px;padding:12px;margin-top:8px}ul{padding:0;list-style:none;display:grid;gap:12px}li button{text-align:left;width:100%;padding:18px 20px;font-weight:600}dt{font-size:13px;color:#51617c;margin-top:20px}dd{margin:4px 0;overflow-wrap:anywhere}footer{font-size:13px;color:#51617c;margin:24px 0}footer a{color:#2d5598;margin-right:20px}@media(max-width:600px){header{align-items:start;flex-direction:column}.layout{margin:20px auto;padding:0 16px}main{padding:20px}h1{font-size:22px}nav button{flex:1 1 40%}}
</style><header><strong>OpenGranter</strong><span>Management / Models</span></header><div class="layout"><aside class="notice"><strong>DEMO · NOT CONNECTED</strong>Synthetic model data only. No login, session, credentials or live backend. Not an authenticated management environment.</aside>
${signedOut ? '' : '<nav aria-label="Demo scenarios"><button id="list" type="button">Model list</button><button id="loading" type="button">Loading</button><button id="empty" type="button">Empty</button><button id="error" type="button">Error (503)</button></nav><p id="scenario" role="status"></p>'}
<div id="app"></div><footer><a href="/signed-out">Public signed-out entry</a><a href="/away">Navigate away (Back test)</a><p>Preview only · Search filters the loaded demo list locally.</p></footer></div><script type="module" src="${signedOut ? '/entry.js' : '/preview.js'}"></script></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startCatalogPreview();
  console.log('Disconnected demo: http://127.0.0.1:18776/');
}
