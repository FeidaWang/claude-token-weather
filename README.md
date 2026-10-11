# Token Weather

A weather forecast for your Claude Code context window. Instead of a raw token count, you get a condition you can read at a glance, and a warning *before* auto-compaction hits.

## What you see

A band above the prompt shows the current condition, how many turns are left until compaction, how much each turn is adding, and your rate-limit and cost figures.

| Condition | Context used (of the compaction point) | Meaning |
| --- | --- | --- |
| ☀️ Clear | under 35% | plenty of room |
| 🌤️ Fair | 35–55% | comfortable |
| ☁️ Cloudy | 55–70% | filling up |
| 🌧️ Showers | 70–85% | compaction ahead |
| ⛈️ Storm | 85%+ | compaction imminent |
| 🌈 Clearing | just compacted | fresh room |

The forecast extrapolates the average growth of your last few turns to estimate the turns remaining. Until it has seen a turn grow, it says so rather than guess.

## Install

```
/plugin marketplace add FeidaWang/token-weather
/plugin install token-weather@token-weather
```

Restart Claude Code to apply.

## Commands

| Command | Does |
| --- | --- |
| `/weather` | Show the band (from any state) |
| `/weather forecast` | Open or close the outlook pane: five-turn outlook, history chart, context breakdown, weather scale |
| `/weather mini` | Tuck the weather into the prompt footer |
| `/weather hide` | Hide it; `/weather` brings it back |

The band also has Forecast, minimize and hide buttons. On the terminal, `f` and `m` are hotkeys for Forecast and minimize.

## Works on

Claude Code terminal and desktop surfaces. It is a Claude Code *mod* (UI and hooks), so it has no effect in chat or Cowork.

## Privacy and data handling

Everything runs locally; the plugin makes no network requests and sends no data anywhere. It reads the session's usage figures and, to rebuild history on resume, the current session's transcript file (token counts and timestamps only). See [PRIVACY.md](PRIVACY.md).

## Development

```
claude plugin validate .      # manifest + hooks
claude plugin test .          # unit and UI tests
./scripts/preflight.sh        # everything the directory's checks look at
```

Source: `hooks/forecast.ts` (levels, forecasting, formatting), `hooks/history.ts` (transcript parsing), `hooks/sky.ts` (animated icons), `hooks/register.tsx` (UI and `/weather`).

## License

MIT. See [LICENSE](LICENSE).
