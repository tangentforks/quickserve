/// API2 client for 1010data QuickApps — works in Node.js and the browser.
/// Requires the standard fetch() API (Node 18+ built-in, or any modern browser).
///
/// Note: standard fetch() always validates SSL certificates. For dev hosts
/// without valid certs, set NODE_TLS_REJECT_UNAUTHORIZED=0.

export interface LoginOptions {
  host?: string;
  ver?:  string;
  uid:   string;
  pwd:   string;
}

export interface CallArgs {
  fmt_?: string;
  [key: string]: unknown;
}

export class API2Error extends Error {
  status:       number;
  responseType: string | null;
  responseText: string;

  constructor(status: number, responseType: string | null, responseText: string) {
    super(`API2 Error ${status}`);
    this.status       = status;
    this.responseType = responseType;
    this.responseText = responseText;
  }
}

export class API2Client {
  box: string;   // remote hostname; empty → relative URLs (browser mode)
  ver: string;
  uid: string;
  epw: string;
  sid: string;

  /// version: optional URL path prefix used in browser mode (e.g. 'beta-latest').
  /// In Node mode, box/ver are set via login().
  constructor(version = '') {
    this.box = '';
    this.ver = version || 'prime-latest';
    this.uid = '';
    this.epw = '';
    this.sid = '';
  }

  isLoggedIn(): boolean { return this.sid !== ''; }
  cookie(): string { return this.isLoggedIn() ? `session=${this.uid}|${this.sid}|${this.epw}` : ''; }

  /// Build the request URL for an API endpoint.
  /// Empty box  → relative /api/... URL (browser proxy mode; quickserve handles routing).
  /// Non-empty box → absolute https://box/ver/api/... URL (Node; cookie set explicitly).
  _url(ep: string, fmt_?: string): string {
    fmt_ = fmt_ || ':json';
    if (!fmt_.startsWith(':')) fmt_ = ':' + fmt_;
    if (ep.startsWith('/')) ep = ep.slice(1);
    // .includes() handles :json.rows and similar compound suffixes
    const ee = ep.split('?');
    if (!ee[0].includes(fmt_)) ee[0] += fmt_;
    ep = ee.join('?');
    const path = `/api/${ep}`;
    if (this.box) return `https://${this.box}/${this.ver}${path}`;
    return path;
  }

  /// Main API2 entry point.
  /// body can be a plain object (JSON-serialised, with fmt_ stripped) or a raw string.
  call(ep: string, body?: CallArgs | string): Promise<unknown> {
    let fmt_: string | undefined;
    let bodyStr: string;
    if (body && typeof body === 'object') {
      const { fmt_: f, ...rest } = body;
      fmt_    = f;
      bodyStr = JSON.stringify(rest);
    } else {
      bodyStr = body ?? '';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.isLoggedIn()) headers['Cookie'] = this.cookie();

    return fetch(this._url(ep, fmt_), {
      method: 'POST',
      headers,
      body: bodyStr || undefined,
    }).then(res => {
      if (!res.ok) {
        return res.text().then(text => {
          throw new API2Error(res.status, res.headers.get('content-type'), text);
        });
      }
      // TODO: handle non-JSON responses (skip parse when fmt_ doesn't start with :json)
      return (res.json() as Promise<unknown>).catch((e: Error) => {
        throw new Error(`Error parsing response from ${ep}: ${e.message}`);
      });
    });
  }

  /// Log into a 1010data instance.
  /// Returns a promise that resolves to this API2Client once logged in.
  login(d: LoginOptions): Promise<API2Client> {
    if (d.host) this.box = d.host;
    if (d.ver)  this.ver = d.ver;
    if (d.uid)  this.uid = d.uid; else throw new Error('Expected d.uid in API2Client.login(d)!');
    if (!d.pwd) throw new Error('Expected d.pwd in API2Client.login(d)!');

    const postBody = new URLSearchParams({ uid: this.uid, pw: d.pwd }).toString();
    console.log(`attempting to log into ${this.box}/${this.ver} as user ${this.uid}...`);

    // TODO: replace with this.call('!login') once the endpoint accepts application/json
    return fetch(`https://${this.box}/${this.ver}/api/!login:json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postBody,
    })
      .then(res => res.json())
      .then((usp: { error?: string; uid?: string; sid: string; epw: string }) => {
        if (usp.error) { console.warn(usp); throw new Error(usp.error); }
        if (usp.uid !== undefined && usp.uid !== this.uid) {
          console.log(`note: uid changed at login. was: ${this.uid}. now: ${usp.uid}`);
          this.uid = usp.uid;
        }
        this.sid = usp.sid;
        this.epw = usp.epw;
        return this;
      });
  }
}

export class API2Widget {
  api2: API2Client;
  tag:  number;
  name: string;

  constructor(api2: API2Client, tag: number, name: string) {
    this.api2 = api2;
    this.tag  = tag;
    this.name = name;
  }

  invoke(method: string, args?: CallArgs): Promise<unknown> {
    return this.api2.call(`${this.tag}/${this.name}/!${method}`, args);
  }
}
