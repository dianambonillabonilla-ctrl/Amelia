# Dilana OS

Internal operations app for Amelia Café / La Wafflería (inventory, recipes, production, counts, transfers, purchases, FUDO reconciliation, users). See `README.md` for full architecture and Apps Script / `clasp` deploy details.

## Cursor Cloud specific instructions

Architecture is three tiers: a static vanilla-JS frontend (root `*.html` + `assets/`), a Google Apps Script backend (`apps-script/*.gs`, deployed as a Web App), and a Google Sheet DB. There is no build step.

- Lint/test/build: the only automated check is `npm test` (plain Node `assert`/`vm`, runs the individual files listed in `package.json`'s `test` script). It runs fully offline — it mocks Apps Script globals and exercises the real `.gs` business logic. CI mirrors this (`.github/workflows/npm-test.yml`, Node 22 + `npm ci` + `npm test`). There is no linter and no build.
- Run the frontend: there is no `npm run dev`/`npm start`. Serve the repo root with any static server, e.g. `python3 -m http.server 3000`, then open `http://localhost:3000/index.html`.
- Backend is cloud-only: the frontend calls the deployed Apps Script `/exec` URL in `assets/config.js` (`API_URL`) via `fetch` POST. You cannot run the backend or the Google Sheet locally; `clasp` is only for pushing/deploying code to Google. Full login → dashboard E2E requires a valid Google-side deployment plus valid user credentials (created via `crearAdministradorInicial_()` in the Apps Script editor), which are not available in the cloud VM.
- A plain `curl` POST to the `/exec` URL may return an HTTP 405 Google Drive page, but a real browser POST from the served page reaches the backend and gets JSON back (e.g. a login attempt returns `{"ok":false,"error":"Usuario o contraseña incorrectos"}`). Use a browser, not curl, to sanity-check backend connectivity.
