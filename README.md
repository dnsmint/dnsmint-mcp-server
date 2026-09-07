# DNSMint MCP server

Lets an agent mint and manage its own hostnames on [DNSMint](https://dnsmint.com), through the [Model Context Protocol](https://modelcontextprotocol.io).

Every other DNSMint integration assumes a human wrote the config first. This one does not: an agent that has just been given a machine can ask for a name for it, mid-task.

## Configure

```json
{
  "mcpServers": {
    "dnsmint": {
      "command": "npx",
      "args": ["-y", "dnsmint-mcp-server"],
      "env": {
        "DNSMINT_API_KEY": "dnsm_..."
      }
    }
  }
}
```

The key needs `hostnames:read` and `hostnames:write`. **Scope it to one domain** and the agent reaches nothing else on the account, which is the point of scoping.

| Variable | |
|---|---|
| `DNSMINT_API_KEY` | Required. |
| `DNSMINT_ALLOW_RELEASE` | `true` to expose `release_hostname`. Off by default. |
| `DNSMINT_API_URL` | API base URL. Defaults to `https://dnsmint.com/api/v1`. |

## Tools

| Tool | |
|---|---|
| `list_hostnames` | Every name the key can see, plus how many are active against the plan's cap. |
| `get_hostname` | One name's status and certificate mode. |
| `mint_hostname` | Register an address, get a stable name back. |
| `repoint_hostname` | The machine moved; the name does not. |
| `diagnose_hostname` | Why a name is or is not working. |
| `release_hostname` | Only when `DNSMINT_ALLOW_RELEASE=true`. See below. |

## Releasing is off by default, on purpose

A released hostname is tombstoned and never issued again, to anyone, including you. There is no undo.

That is a bad thing to leave within reach of a model deciding to tidy up, so `release_hostname` is not registered unless you set `DNSMINT_ALLOW_RELEASE=true`. When it is, the tool takes a `confirm` argument that must equal the hostname exactly, checked against the id before anything happens — so a name cannot be released by guessing an id or half-remembering a name.

If the goal is to stop serving, repoint the name or stop the machine. Releasing is for names that are genuinely finished with.

## What the tool descriptions carry

The descriptions are the interface a model actually reads, so they state the rules the API enforces rather than leaving a model to discover them by being refused:

- A hostname is one label above a domain. Names below a hostname are not hostnames.
- The address class is fixed for life. Public stays public, private stays private; crossing is refused, because one name resolving public then private is how DNS rebinding works.
- A newly minted name is `pending` and goes `live` within about a minute.
- The API does not say where a name points. DNS is the authoritative answer, which is what `diagnose_hostname` reports.

## Development

```sh
npm install
npm run build
```

## Support

Something not working, or a case this does not cover? Open an issue here, or write to [hello@dnsmint.com](mailto:hello@dnsmint.com). This server is maintained by the DNSMint team.
