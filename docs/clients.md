# Client configuration

`mal-mcp` is a standard stdio MCP server, so any MCP-compatible client can run it.
The simplest way is `npx` (no clone, no build):

- command: `npx`
- args: `["-y", "mal-mcp"]`

The `env` block is optional — omit it to use only the credential-free read tools.
If you built from source instead, use `command: "node"`, `args: ["/abs/path/mal-mcp/dist/index.js"]`.

## Claude Desktop / Claude Code

`claude_desktop_config.json` (or via `claude mcp add`):

```json
{
  "mcpServers": {
    "mal": {
      "command": "npx",
      "args": ["-y", "mal-mcp"],
      "env": {
        "MAL_CLIENT_ID": "..."
      }
    }
  }
}
```

For Claude Desktop you can instead install the `.mcpb` bundle from the
[releases page](https://github.com/Grinv/mal-mcp/releases) for a one-click setup.

## Cursor

`.cursor/mcp.json` (project) or the global equivalent:

```json
{
  "mcpServers": {
    "mal": { "command": "npx", "args": ["-y", "mal-mcp"] }
  }
}
```

## VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "mal": { "type": "stdio", "command": "npx", "args": ["-y", "mal-mcp"] }
  }
}
```

## Cline / Continue / other clients

Use the same pattern — a stdio server with:

- command: `npx`
- args: `["-y", "mal-mcp"]`
- env (optional): `MAL_CLIENT_ID` (then run the `login_mal` tool). Advanced: pre-supply
  `MAL_REFRESH_TOKEN` or a standalone `MAL_ACCESS_TOKEN`.

See [auth.md](auth.md) for the login walkthrough.
