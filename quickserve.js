/// file-watching dev server for quickapps

// requirements
const
  fs = require('fs'), // file system
  http = require('http'),
  ws = require('ws'), // websocket
  chokidar = require('chokidar'), // file watcher
  // ---
  n10 = require('./1010api2-fetch');

/// the host:port combo on which to run the local web server.
const HOST = "localhost", PORT = 8080;

/// global session information:
const SESS = { client:null };

/// helper routine to show an HTTP error message.
function httpErr(res, statusCode, msg) {
  res.writeHead(statusCode, {'Content-type': 'text/plain'});
  res.write(statusCode + ' ' + msg);
  res.end()}

function redirect(res, path) {
  res.writeHead(303, {'Location': path});
  res.end()}


let MOUNT_CONFIG = 'dev-mounts.json';
let mountedPaths = [];
let validPaths = [];
if (fs.existsSync(MOUNT_CONFIG)) {
  try {
    let m = JSON.parse(fs.readFileSync(MOUNT_CONFIG).toString());
    m.forEach(kv => {
      mountedPaths.push([new RegExp(kv[0]), kv[1]]);
      validPaths.push(kv[1]);});
  } catch(e) {
    console.log(`error parsing ${MOUNT_CONFIG}:` + e.toString());
    console.log('expected a list of regexp/replace pairs.');
  }
}

function validPath(path) {
  if (path.startsWith(process.cwd())) return true;
  else for (let i=0; i<validPaths.length; i++) {
    if (path.startsWith(validPaths[i])) return true;}
  console.log('!! invalid path requested: ' + path);
  console.log('valid paths:', validPaths);
  return false}


/// serve a static file from the current directory.
function staticFile(res, path0) {
  fs.realpath(path0, (err, path)=> {
    console.log("serving: " + path);
    if (err) console.log('err:', err);
    if (err || !validPath(path)) httpErr(res, 404, 'Not Found');
    else fs.readFile(path, function(err, data) {
      if (err) httpErr(res, 500, 'Internal Server Error: unable to read ' + path0);
      // TODO: find a decent mime type module
      var ct = path.endsWith('.json') ? 'application/json'
             : path.endsWith('.js')   ? 'application/javascript'
             : path.endsWith('.xml')  ? 'text/xml'
             : path.endsWith('.png')  ? 'image/png'
             : path.endsWith('.css')  ? 'text/css'
             : 'text/html';
      res.writeHead(200, {'Content-Type': ct});
      res.write(data);
      res.end()})})}

/// routine to log in to API2 on a 1010data instance
function login(res, d) {
  fs.writeFile('.last-login.json',
    JSON.stringify({host:d.host, ver:d.ver, uid: d.uid}), err => {
    // no big deal if this fails. it's just for convenience.
    if (err) console.log('failed to save .last-login.json:' + err)});
  new n10.API2Client().login(d)
    .then(c => { SESS.client = c; redirect(res, '/')})
    .catch(e => httpErr(res, 400, e.message ))}

function logout(res) {
  SESS.client = null;
  redirect(res, '/')}

/// relay a request to the active 1010data API2 session.
/// c is the API2Client, data is the post body(if any)
function relay_api(req, res, c, data) {
  c.call(req.url.slice(5), data)
   .then(d => {
     res.writeHead(200, {'Content-type': 'application/json'});
     res.write(JSON.stringify(d));
     res.end(); })
   .catch(e => {
     if (e instanceof n10.API2Error) {
       res.writeHead(e.status, {'Content-type': e.responseType});
       res.write(e.responseText);
       res.end(); }
     else return httpErr(res, 400, 'BAD REQUEST\n\n' + e ) });}

/// relay a request to the 1010 gui or a cgi script.
/// c is the API2Client, data is the post body (if any)
function relay_nonapi(url, req, res, c, data) {
  let rr, args = {method:req.method, headers: new Headers()};
  for (const [k,v] of Object.entries(req.headers)) {
    if (k == 'host' || k === 'cookie') continue;
    else args.headers.set(k,v)}
  if (c.isLoggedIn()) args.headers.set('Cookie', `${c.cookie()}; siduids=${c.sid}|${c.uid}`);
  if (req.method === 'POST') args.body = data;
  fetch(url, args)
    .then(rr0 => { rr = rr0; return rr.text()})
    .then(text => {
      res.writeHead(rr.status, Object.fromEntries(rr.headers));
      res.write(text.replaceAll(c.ver,'remote'));
      res.end()})
    .catch(e => httpErr(res, 502, 'Bad Gateway: ' + e.message))}

function relay_gui(req, res, c, data) {
  let url = `https://${c.box}/${c.ver}/`+req.url.split('/').slice(2).join('/');
  relay_nonapi(url, req, res, c, data)}

function relay_cgi(req, res, c, data) {
  let url = `https://${c.box}/cgi-bin/${c.ver}/`+req.url.split('/').slice(3).join('/');
  relay_nonapi(url, req, res, c, data)}

function dispatch(req, res, data) {
  console.log(req.method + ' ' + req.url + ' ' + JSON.stringify(data||''));
  if (req.url === '/login') login(res, Object.fromEntries(new URLSearchParams(data)));   // login uses a normal form post
  else if (!SESS.client && !req.url.endsWith('.json')) staticFile(res, 'login.html');
  else if (req.url === '/!logout') logout(res);
  else if (req.url === '/') staticFile(res, 'index.html');
  else if (req.url.startsWith('/api/')) relay_api(req, res, SESS.client, data);
  else if (req.url.startsWith('/remote/')) relay_gui(req, res, SESS.client, data);
  else if (req.url.startsWith('/cgi-bin/remote/')) relay_cgi(req, res, SESS.client, data);
  else { // mounted path or local directory
    let url = req.url;
    for (const kv of mountedPaths) { if (kv[0].test(url)) { url = url.replace(kv[0], kv[1]); break; } }
    if (url === req.url) url = './' + url; // if unchanged, use local dir.
    staticFile(res, url)}}

/// an http.Server instance for local quickapp development
const srv = http.createServer((req, res)=> {
  if (req.method === 'POST') {
    let data = '';
    req.on('data', function (chunk) {
      data += chunk;
      if (data.length > 1e6) {
        httpErr(res, 413, 'Request too large');
        req.socket.destroy()}});
    req.on('end', function() { dispatch(req, res, data)})}
  else { dispatch(req, res) }});

let appPath = process.argv[2] || 'quickapp.xml';

/// websocket server
const wss = new ws.Server({server: srv, path: '/ws'});
wss.on('connection', (ws)=> {
  if (!SESS.client) { ws.close(); return; }
  ws.send(JSON.stringify(['setup', [SESS.client.box, SESS.client.ver, appPath]]));
  ws.on('message', (msg)=> {
    console.log('received: ' + msg); })});
function broadcast(msg) {
  console.log('broadcasting: ' + JSON.stringify(msg));
  wss.clients.forEach(c => c.send(JSON.stringify(msg)))}

/// file watcher
const watcher = chokidar.watch('.',
  {ignored: /(^|[\/\\])(\.|node_modules)/, persistent: true});
watcher.on('change', (path,info) => {
  console.log(`file changed: ${[path, JSON.stringify(info)]}`);
  if (path==='index.html') broadcast(["refresh"]);
  else if (path.endsWith('.xml')) broadcast(["reload", path])});

// start server
console.log(`listening at http://${HOST}:${PORT}/`);
srv.listen(PORT, HOST);
