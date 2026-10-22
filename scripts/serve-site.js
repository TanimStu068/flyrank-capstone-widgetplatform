// Tiny static server for the demo "customer site": a second origin (port 5500) for CORS proofs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'customer-site');
const port = Number(process.env.SITE_PORT || 5500);
http.createServer((req, res) => {
  const file = req.url.split('?')[0] === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
  fs.readFile(path.join(dir, file), (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(buf);
  });
}).listen(port, () => console.log(`customer site on http://localhost:${port}`));
