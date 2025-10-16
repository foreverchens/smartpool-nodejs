# Repository Guidelines

## Project Structure & Module Organization

- `Main.js` orchestrates the quant batch, writing snapshots through `service/SmartPoolMapper.js` into
  `data/latest.json`.
- `Grid.js` loads strategies from `grid/data/grid_tasks.json` and drives the engine under `grid/`.
- `WebServer.js` serves dashboards in `view/` and exposes read-only APIs; shared helpers live in `common/`, exchange
  integrations in `service/`.
- Runtime artefacts belong in `data/` and `grid/common/logs/`; keep tracked data lean and fixture-focused.

## Build, Test, and Development Commands

- Use Node 18+ and install dependencies once with `npm install express piscina lowdb axios node-binance-api`.
- `node Main.js` runs one quant batch; `node --watch Main.js` is handy locally but keep watch scripts uncommitted.
- `node WebServer.js` hosts `http://localhost:3000` for reviewing the latest batch.
- `node Grid.js` launches the continuous grid loop—stop with Ctrl+C when validating tasks.

## Coding Style & Naming Conventions

- Stick to four-space indentation, ESM syntax, and descriptive `const` declarations.
- Functions and variables stay `camelCase`, classes/interfaces `PascalCase`, JSON keys lowercase.
- Prefer `grid/common/logger.js` over ad-hoc `console` calls for recurring logs.

## Testing Guidelines

- No automated suite exists; add `node:test` (or similar) specs alongside modules as `<name>.test.js`.
- Mock Binance calls (see comments in `grid/common/CzClientTest.js`) and commit only deterministic fixtures under
  `data/fixtures/`.
- Cover edge cases such as empty symbol lists, invalid `gridRate`, and persistence failures before submitting.

## Commit & Pull Request Guidelines

- Mirror existing short imperatives (`GTX策略优化`, `统一返回结构&禁止反向`); keep subjects ≤72 characters.
- Bundle related code, config, and fixture changes together, and list validation commands in the PR body.
- Provide screenshots for `view/` changes and reference issues or requirements when available.

## Security & Configuration Tips

- Move API credentials into env vars (e.g., `BINANCE_API_KEY`, `BINANCE_API_SECRET`) and scrub the placeholders in
  `grid/common/CzClient.js:7`.
- Do not commit personal `data/*.json` snapshots or sensitive log output from `grid/common/logs/`; redact before
  sharing.
