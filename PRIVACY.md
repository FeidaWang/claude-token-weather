# Privacy

Context Forecast runs entirely on your machine.

- **Reads:** the context-usage figures Claude Code reports for the current session (tokens, window size, rate-limit percentages, session cost), and the current session's own transcript file under `$CLAUDE_CONFIG_DIR` (default `~/.claude/projects/...`), read locally (via `tail`) only to rebuild the token history when a session is resumed. Only token counts and timestamps are used; message text is never stored or displayed.
- **Stores:** a small in-memory/session state (recent token samples, last reading, display mode). Nothing is written outside Claude Code's own plugin state.
- **Sends:** nothing. The plugin makes no network requests, bundles no MCP server, and does not read credentials or environment secrets.
- **Age:** the plugin is not directed at people under 18 and collects no personal data.

Questions: founder@rsiagent.app
