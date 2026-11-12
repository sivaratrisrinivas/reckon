import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { Worker } from 'near-workspaces';

const worker = await Worker.init();
const root = worker.rootAccount;
const contract = await root.devDeploy('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm', {
  initialBalance: 120n * 10n ** 24n,
  method: 'new',
  args: { initial_bankroll: (100n * 10n ** 24n).toString(), operational_reserve: (20n * 10n ** 24n).toString(), idle_life_ns: '900000000000' },
});
const files: Record<string, [string, string]> = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/diagnostic': ['public/diagnostic.html', 'text/html; charset=utf-8'],
  '/diagnostic-evidence.json': ['docs/evidence/model-attempt-1.json', 'application/json; charset=utf-8'],
  '/diagnostic-instruct-evidence.json': ['docs/evidence/model-attempt-instruct.json', 'application/json; charset=utf-8'],
  '/diagnostic.js': ['public/diagnostic.js', 'text/javascript; charset=utf-8'],
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/diagnostic/latest' && req.method === 'GET') {
      const names = await readdir('.local/diagnostic-runs').catch(() => []);
      const latest = names.filter(name => /^\d+\.json$/.test(name)).sort().at(-1);
      if (!latest) { res.writeHead(404).end(); return; }
      const body = await readFile(`.local/diagnostic-runs/${latest}`);
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(body);
      return;
    }
    if (req.url === '/api/life' && req.method === 'GET') {
      const life = await contract.view('life', {});
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(life));
      return;
    }
    if (process.env.RECKON_TEST === '1' && req.url === '/test/advance' && req.method === 'POST') {
      await worker.provider.fastForward(300);
      res.writeHead(204).end();
      return;
    }
    const file = files[req.url ?? ''];
    if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const body = await readFile(file[0]);
    res.writeHead(200, {'Content-Type': file[1]});
    res.end(body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(503, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'Sandbox unavailable'}));
  }
});
const port = Number(process.env.PORT ?? 4389);
server.listen(port, '127.0.0.1', () => console.log(`Reckon local sandbox: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { void worker.tearDown().finally(() => process.exit()); }));
