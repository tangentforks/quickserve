#!/usr/bin/env node
/// file-watching dev server for quickapps

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { API2Client, API2Error } from './API2Client.mjs';

const HOST = 'localhost', PORT = 8080;

/// Absolute path to the dist/ directory (where this file lives when compiled).
/// Works whether run via `node dist/quickserve.mjs` or `tsx quickserve.mts`.
const distDir     = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(distDir, '..');

const SESS: { client: API2Client | null } = { client: null };

function httpErr(res: http.ServerResponse, statusCode: number, msg: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
  res.write(statusCode + ' ' + msg);
  res.end();
}

function redirect(res: http.ServerResponse, path: string): void {
  res.writeHead(303, { Location: path });
  res.end();
}

const MOUNT_CONFIG = 'dev-mounts.json';
const mountedPaths: [RegExp, string][] = [];
const validPaths: string[] = [];
if (fs.existsSync(MOUNT_CONFIG)) {
  try {
    const m: [string, string][] = JSON.parse(fs.readFileSync(MOUNT_CONFIG).toString());
    m.forEach(([pattern, replacement]) => {
      mountedPaths.push([new RegExp(pattern), replacement]);
      validPaths.push(replacement);
    });
  } catch (e) {
    console.log(`error parsing ${MOUNT_CONFIG}: ` + e);
    console.log('expected a list of [regexp, path] pairs.');
  }
}

function validPath(p: string): boolean {
  if (p.startsWith(process.cwd())) return true;
  if (p.startsWith(packageRoot))   return true;  // package assets (HTML, JS)
  for (const vp of validPaths) {
    if (p.startsWith(vp)) return true;
  }
  console.log('!! invalid path requested: ' + p);
  console.log('valid paths:', validPaths);
  return false;
}

/// serve a static file from the current directory.
function staticFile(res: http.ServerResponse, path0: string): void {
  fs.realpath(path0, (err, path) => {
    console.log('serving: ' + path);
    if (err) console.log('err:', err);
    if (err || !validPath(path)) { httpErr(res, 404, 'Not Found'); return; }
    fs.readFile(path, (readErr, data) => {
      if (readErr) { httpErr(res, 500, 'Internal Server Error: unable to read ' + path0); return; }
      // TODO: replace with a proper mime-type module
      const ct = path.endsWith('.mjs')  ? 'application/javascript'
               : path.endsWith('.json') ? 'application/json'
               : path.endsWith('.js')   ? 'application/javascript'
               : path.endsWith('.xml')  ? 'text/xml'
               : path.endsWith('.png')  ? 'image/png'
               : path.endsWith('.css')  ? 'text/css'
               :                          'text/html';
      res.writeHead(200, { 'Content-Type': ct });
      res.write(data);
      res.end();
    });
  });
}

/// log in to API2 on a 1010data instance.
function login(res: http.ServerResponse, d: Record<string, string>): void {
  fs.writeFile('.last-login.json',
    JSON.stringify({ host: d.host, ver: d.ver, uid: d.uid }), err => {
      if (err) console.log('failed to save .last-login.json: ' + err);
    });
  new API2Client().login(d as { uid: string; pwd: string; host?: string; ver?: string })
    .then(c => { SESS.client = c; redirect(res, '/'); })
    .catch((e: Error) => httpErr(res, 400, e.message));
}

function logout(res: http.ServerResponse): void {
  SESS.client = null;
  redirect(res, '/');
}

/// relay a request to the active 1010data API2 session.
function relay_api(req: http.IncomingMessage, res: http.ServerResponse, c: API2Client, data?: string): void {
  c.call((req.url ?? '').slice(5), data)
    .then(d => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(JSON.stringify(d));
      res.end();
    })
    .catch((e: unknown) => {
      if (e instanceof API2Error) {
        res.writeHead(e.status, { 'Content-Type': e.responseType ?? 'text/plain' });
        res.write(e.responseText);
        res.end();
      } else {
        httpErr(res, 400, 'BAD REQUEST\n\n' + e);
      }
    });
}

/// relay a request to the 1010 GUI or a cgi script.
function relay_nonapi(url: string, req: http.IncomingMessage, res: http.ServerResponse, c: API2Client, data?: string): void {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'host' || k === 'cookie') continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  if (c.isLoggedIn()) headers.set('Cookie', `${c.cookie()}; siduids=${c.sid}|${c.uid}`);

  const init: RequestInit = { method: req.method, headers };
  if (req.method === 'POST') init.body = data;

  let rr: Response;
  fetch(url, init)
    .then(rr0 => { rr = rr0; return rr.text(); })
    .then(text => {
      res.writeHead(rr.status, Object.fromEntries(rr.headers));
      res.write(text.replaceAll(c.ver, 'remote'));
      res.end();
    })
    .catch((e: Error) => httpErr(res, 502, 'Bad Gateway: ' + e.message));
}

function relay_gui(req: http.IncomingMessage, res: http.ServerResponse, c: API2Client, data?: string): void {
  const url = `https://${c.box}/${c.ver}/` + (req.url ?? '').split('/').slice(2).join('/');
  relay_nonapi(url, req, res, c, data);
}

function relay_cgi(req: http.IncomingMessage, res: http.ServerResponse, c: API2Client, data?: string): void {
  const url = `https://${c.box}/cgi-bin/${c.ver}/` + (req.url ?? '').split('/').slice(3).join('/');
  relay_nonapi(url, req, res, c, data);
}

function dispatch(req: http.IncomingMessage, res: http.ServerResponse, data?: string): void {
  const url = req.url ?? '/';
  console.log(req.method + ' ' + url + ' ' + JSON.stringify(data ?? ''));
  if      (url === '/login')                    login(res, Object.fromEntries(new URLSearchParams(data)));
  else if (!SESS.client && !url.endsWith('.json')) staticFile(res, path.join(packageRoot, 'login.html'));
  else if (url === '/!logout')                  logout(res);
  else if (url === '/')                         staticFile(res, path.join(packageRoot, 'index.html'));
  else if (url.startsWith('/_qs/'))             staticFile(res, path.join(distDir, url.slice(5)));
  else if (url.startsWith('/api/'))             relay_api(req, res, SESS.client!, data);
  else if (url.startsWith('/remote/'))          relay_gui(req, res, SESS.client!, data);
  else if (url.startsWith('/cgi-bin/remote/'))  relay_cgi(req, res, SESS.client!, data);
  else {
    let localUrl = url;
    for (const [pattern, replacement] of mountedPaths) {
      if (pattern.test(localUrl)) { localUrl = localUrl.replace(pattern, replacement); break; }
    }
    if (localUrl === url) localUrl = './' + localUrl;
    staticFile(res, localUrl);
  }
}

/// HTTP server
const srv = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let data = '';
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 1e6) { httpErr(res, 413, 'Request too large'); req.socket?.destroy(); }
    });
    req.on('end', () => dispatch(req, res, data));
  } else {
    dispatch(req, res);
  }
});

const appPath = process.argv[2] ?? 'quickapp.xml';

/// websocket server
const wss = new WebSocketServer({ server: srv, path: '/ws' });
wss.on('connection', socket => {
  if (!SESS.client) { socket.close(); return; }
  socket.send(JSON.stringify(['setup', [SESS.client.box, SESS.client.ver, appPath]]));
  socket.on('message', msg => { console.log('received: ' + msg); });
});

function broadcast(msg: unknown[]): void {
  console.log('broadcasting: ' + JSON.stringify(msg));
  wss.clients.forEach(c => c.send(JSON.stringify(msg)));
}

/// file watcher
chokidar.watch('.', { ignored: /(^|[/\\])(\.|node_modules)/, persistent: true })
  .on('change', path => {
    console.log('file changed: ' + path);
    if (path === 'index.html')    broadcast(['refresh']);
    else if (path.endsWith('.xml')) broadcast(['reload', path]);
  });

console.log(`listening at http://${HOST}:${PORT}/`);
srv.listen(PORT, HOST);
