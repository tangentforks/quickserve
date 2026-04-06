define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.API2Widget = exports.API2Client = void 0;
    class API2Client {
        constructor(version = '') {
            this.version = '';
            // TODO: No login function yet -- we're assuming the user already has cookies.
            this.version = version;
        }
        _fmt(ep, fmt_) {
            fmt_ = fmt_ || ':json';
            if (!fmt_.startsWith(':'))
                fmt_ = ':' + fmt_;
            if (ep.startsWith('/'))
                ep = ep.slice(1);
            let ee = ep.split('?');
            if (!ee[0].endsWith(fmt_)) {
                ee[0] += fmt_;
            }
            ep = ee.join('?');
            return ep;
        }
        _url(ep, fmt_) {
            let result = `/api/${this._fmt(ep, fmt_)}`;
            if (this.version !== '')
                result = '/' + this.version + result;
            return result;
        }
        // main API2 entry point:
        call(ep, args, type = 'application/json') {
            if (!args)
                args = {};
            const data = args ? JSON.stringify(args) : '';
            return new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.open(args.method_ || "POST", this._url(ep, args.fmt_), true);
                xhr.onreadystatechange = () => {
                    if (xhr.readyState !== xhr.DONE)
                        return;
                    if (xhr.status !== 200)
                        reject(xhr);
                    // TODO: only parse if fmt_.startsWith(json)
                    else
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        }
                        catch (e) {
                            reject(e);
                        }
                };
                xhr.setRequestHeader('Content-type', type || 'application/json');
                xhr.send(data);
            });
        }
    }
    exports.API2Client = API2Client;
    class API2Widget {
        constructor(api2, tag, name) {
            this.api2 = api2;
            this.tag = tag;
            this.name = name;
        }
        invoke(method, args) {
            let ep = `${this.tag}/${this.name}/!${method}`;
            return this.api2.call(ep, args);
        }
    }
    exports.API2Widget = API2Widget;
});
