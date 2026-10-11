# Changelog

## 0.1.4

- Stop starting a process: oversized transcripts (over 4 MiB) are no longer read with `tail`; history backfill is skipped for them.
- Rename the internal `fmtTokens` helper to `fmtCount`.

## 0.1.3

- Restore the `types` manifest field (needed to declare plugin state).
- Write `register` as a function declaration, give the API type a non-`$` name, and move timer and refresh logic into top-level helpers so the directory's analyzer can follow every `$` use.

## 0.1.2

- Renamed from Token Weather to Context Forecast (plugin id `context-forecast`).
- License is Apache-2.0, matching the upstream sample this mod derives from; added NOTICE with attribution.

## 0.1.1

- Add listing icon; remove the unused `types` manifest field.
- README now states exactly what the mod reads, runs, and sends.

## 0.1.0

- Weather band above the prompt: condition (Clear, Fair, Cloudy, Showers, Storm, Clearing), turns left to compaction, per-turn growth, rate-limit and cost readouts.
- `/weather forecast` pane with a five-turn outlook, history chart, context breakdown and weather scale.
- `/weather mini` and `/weather hide` to minimize or hide the band; bare `/weather` brings it back.
- History is rebuilt from the session transcript when a session is resumed.
- Works on the terminal and desktop surfaces.
