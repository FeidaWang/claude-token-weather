# Context Forecast

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
/plugin marketplace add FeidaWang/context-forecast
/plugin install context-forecast@context-forecast
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

## What it reads, runs, and sends

Everything runs locally. The mod sends nothing anywhere: it makes no network requests, bundles no MCP server, and calls no model.

- **Reads session usage.** The context size, window, rate-limit percentages and session cost that Claude Code reports for the current session (`$.session.usage`).
- **Reads two environment variables, `HOME` and `CLAUDE_CONFIG_DIR`**, only to work out where Claude Code keeps the current session's transcript (`<config dir>/projects/<project>/<session id>.jsonl`). No credential or secret is read, and the values are never stored or sent.
- **Reads the current session's transcript file** (`$.fs.read`) when a session starts or is resumed, to rebuild the token history (transcripts over the 4 MiB file-read limit are skipped, and the forecast builds from live readings instead). Only token counts, request ids, and timestamps are used; message text is never kept or shown.
- **Runs no programs.** The mod starts no processes and makes no shell calls.
- **Handles the `/weather` command itself** (`forecast`, `mini`, `hide`, or no argument). It does not touch permissions, agents, settings, or Remote Control.
- **Keeps state** (recent token samples, last reading, display mode) in Claude Code's own plugin state.

See [PRIVACY.md](PRIVACY.md) for the data-handling summary.

## Development

```
claude plugin validate .      # manifest + hooks
claude plugin test .          # unit and UI tests
./scripts/preflight.sh        # everything the directory's checks look at
```

Source: `hooks/forecast.ts` (levels, forecasting, formatting), `hooks/history.ts` (transcript parsing), `hooks/sky.ts` (animated icons), `hooks/register.tsx` (UI and `/weather`).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Context Forecast is derived from the `token-weather` sample mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) (Apache-2.0). It is an independent project, not an Anthropic product.
