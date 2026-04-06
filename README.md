# quickserve

A dev server for [1010data](https://www.1010data.com) QuickApps. Watches local XML files and live-reloads the app in the browser on every save.

Requires [Node.js](https://nodejs.org) 18+.

## setup

In your QuickApp project directory:

```sh
npx quickserve init      # enter gateway URL, username, password → writes quickserve.json
npx quickserve app.xml   # start the dev server
```

Then open http://localhost:8080/. Edit `app.xml` and the browser reloads automatically.

## how it works

- `quickserve init` saves credentials to `quickserve.json` (gitignored automatically).
- On startup, quickserve logs in and uploads the XML via API2. An iframe displays the running app.
- Any `.xml` change triggers a re-upload and iframe refresh.
- Pass a different XML file as an argument, or omit it to default to `quickapp.xml`.

## installing system-wide

```sh
cd /path/to/quickserve
npm install
npm run build
npm link
```

After that, `quickserve` is available in any directory. To unlink: `npm unlink -g quickserve`.

## developing quickserve itself

```sh
npm install
npm run quickserve       # tsc + tsx quickserve.mts
npm run build            # recompile dist/
```
