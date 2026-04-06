/// Unified API2 client for Node.js and the browser using the standard fetch() API.
/// Requires fetch() — Node 18+ built-in, or any modern browser.
///
/// Note: unlike the previous Node.js client, standard fetch() always validates SSL
/// certificates. For dev hosts without valid certs, set NODE_TLS_REJECT_UNAUTHORIZED=0.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.api2 = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

class API2Error extends Error {
  constructor(status, responseType, responseText) {
    super(`API2 Error ${status}`);
    this.status = status;
    this.responseType = responseType;
    this.responseText = responseText;
  }
}

class API2Client {

  /// version: optional URL path prefix (e.g. 'beta-latest'), used in browser mode.
  /// In Node mode, box/ver are set via login().
  constructor(version = '') {
    this.box = '';   // remote hostname; empty means use relative URLs (browser)
    this.ver = version || 'prime-latest';
    this.uid = '';
    this.epw = '';
    this.sid = '';
  }

  isLoggedIn() { return this.sid !== ''; }
  cookie() { return this.isLoggedIn() ? `session=${this.uid}|${this.sid}|${this.epw}` : ''; }

  /// Build the full URL for an API endpoint.
  /// When box is set (Node), returns an absolute https:// URL.
  /// When box is empty (browser), returns a relative /api/... URL.
  _url(ep, fmt_) {
    fmt_ = fmt_ || ':json';
    if (!fmt_.startsWith(':')) fmt_ = ':' + fmt_;
    if (ep.startsWith('/')) ep = ep.slice(1);
    // .includes() handles :json.rows and similar compound suffixes
    let ee = ep.split('?');
    if (!ee[0].includes(fmt_)) { ee[0] += fmt_; }
    ep = ee.join('?');
    let path = `/api/${ep}`;
    if (this.ver && !this.box) path = `/${this.ver}${path}`;  // browser version prefix
    if (this.box) path = `https://${this.box}/${this.ver}${path}`;
    return path;
  }

  /// Main API2 entry point.
  /// ep:   endpoint string (everything after /api/)
  /// body: JS object (will be JSON-serialised) or raw string
  call(ep, body) {
    let fmt_;
    let bodyStr;
    if (body && typeof body === 'object') {
      // strip special control properties before serialising
      const { fmt_: f, ...rest } = body;
      fmt_ = f;
      bodyStr = JSON.stringify(rest);
    } else {
      bodyStr = body || '';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.isLoggedIn()) headers['Cookie'] = this.cookie();

    return fetch(this._url(ep, fmt_), {
      method: 'POST',
      headers,
      body: bodyStr || undefined,
    }).then(res => {
      if (!res.ok) {
        return res.text().then(text => {
          console.log('-- error from server ------------------------------------');
          console.log(res.status, res.headers.get('content-type'));
          console.log(text);
          console.log('---------------------------------------------------------');
          throw new API2Error(res.status, res.headers.get('content-type'), text);
        });
      }
      // TODO: handle non-JSON responses (skip parse when fmt_ doesn't start with :json)
      return res.json().catch(e => {
        throw new Error(`Error parsing response from ${ep}: ${e.message}`);
      });
    });
  }

  /// Log into a 1010data instance. d = { host?, ver?, uid, pwd }
  /// Returns a promise that resolves to this API2Client once logged in.
  login(d) {
    if (d.host) this.box = d.host;
    if (d.ver)  this.ver  = d.ver;
    if (d.uid)  this.uid  = d.uid; else throw new Error('Expected d.uid in API2Client.login(d)!');
    if (!d.pwd) throw new Error('Expected d.pwd in API2Client.login(d)!');

    const postBody = new URLSearchParams({ uid: this.uid, pw: d.pwd }).toString();
    console.log(`attempting to log into ${this.box}/${this.ver} as user ${this.uid}...`);

    // TODO: replace with this.call('!login') once the endpoint accepts application/json
    return fetch(`https://${this.box}/${this.ver}/api/!login:json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postBody,
    }).then(res => res.json()).then(usp => {
      if (usp.error) { console.warn(usp); throw new Error(usp.error); }
      if (usp.uid !== this.uid) {
        console.log(`note: uid changed at login. was: ${this.uid}. now: ${usp.uid}`);
        this.uid = usp.uid;
      }
      this.sid = usp.sid;
      this.epw = usp.epw;
      return this;
    });
  }
}

class API2Widget {
  constructor(api2, tag, name) {
    this.api2 = api2;
    this.tag  = tag;
    this.name = name;
  }

  invoke(method, args) {
    return this.api2.call(`${this.tag}/${this.name}/!${method}`, args);
  }
}

return { API2Client, API2Error, API2Widget };

}));
