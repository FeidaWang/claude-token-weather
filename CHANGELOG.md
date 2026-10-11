# Changelog

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
