# Client configuration

`mal-mcp` is a standard stdio MCP server, so any MCP-compatible client can run it
by launching `node /absolute/path/to/mal-mcp/dist/index.js`. Build it first
(`npm ci && npm run build`).

Replace `/ABS/PATH/mal-mcp` with the absolute path to your clone. The `env` block
is optional — omit it to use only the credential-free read tools.

> Once published to npm, the command becomes `npx -y mal-mcp` with no path. This
> section will be updated then.

## Claude Desktop / Claude Code

`claude_desktop_config.json` (or via `claude mcp add`):

```json
{
  "mcpServers": {
    "mal": {
      "command": "node",
      "args": ["/ABS/PATH/mal-mcp/dist/index.js"],
      "env": {
        "MAL_CLIENT_ID": "...",
        "MAL_CLIENT_SECRET": "...",
        "MAL_REFRESH_TOKEN": "..."
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
    "mal": { "command": "node", "args": ["/ABS/PATH/mal-mcp/dist/index.js"] }
  }
}
```

## VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "mal": { "type": "stdio", "command": "node", "args": ["/ABS/PATH/mal-mcp/dist/index.js"] }
  }
}
```

## Cline / Continue / other clients

Use the same pattern — a stdio server with:

- command: `node`
- args: `["/ABS/PATH/mal-mcp/dist/index.js"]`
- env (optional): `MAL_ACCESS_TOKEN` or the `MAL_CLIENT_ID`/`MAL_CLIENT_SECRET`/`MAL_REFRESH_TOKEN` trio.

See [auth.md](auth.md) for obtaining the token values.
