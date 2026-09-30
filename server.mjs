// server.mjs — a tiny static server so the whole app can run from a folder with no internet.
//
// Why a server at all instead of opening index.html directly? The app uses ES modules and fetches its
// data files, which browsers block on the file:// protocol. This serves the folder as-is, adds the
// right content types for vector tiles and glyphs, and gzips text so the laptop demo feels instant.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WANT_OPEN = process.argv.includes('--open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.mvt': 'application/vnd.mapbox-vector-tile',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.geojson', '.mvt', '.svg', '.md', '.txt']);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Not found: ${rel}\n\nIf a data file is missing, run: node pipeline/07-bundle.mjs`);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'content-type': type };
    const immutable = rel.startsWith('/data/tiles/') || rel.startsWith('/data/terrain/') || rel.startsWith('/data/fonts/') || rel.startsWith('/data/sprites/');
    // Tiles, terrain and fonts never change once baked; everything the pipeline regenerates is
    // served no-store so a re-run of the pipeline is picked up on the next refresh.
    const dynamic = ['.html', '.js', '.mjs', '.css', '.json', '.geojson'].includes(ext);
    headers['cache-control'] = immutable ? 'public, max-age=86400' : dynamic ? 'no-store' : 'public, max-age=300';

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024) {
      fs.readFile(target, (readErr, body) => {
        if (readErr) {
          res.writeHead(500).end('Read error');
          return;
        }
        const gz = zlib.gzipSync(body);
        res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': gz.length });
        res.end(req.method === 'HEAD' ? undefined : gz);
      });
      return;
    }

    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
});

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

const requested = Number.parseInt(process.env.PORT ?? '', 10);
let port = Number.isFinite(requested) && requested > 0 ? requested : 8123;
let attempts = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 10) {
    attempts++;
    port++;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(err.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${server.address().port}/`;
  console.log('Flood Time Machine is running');
  console.log(`  open:  ${url}`);
  console.log('  this is the offline copy — no internet connection is used.');
  console.log('  press Ctrl+C to stop.');
  if (WANT_OPEN) setTimeout(() => openBrowser(url), 350);
});
