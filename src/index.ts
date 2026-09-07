#!/usr/bin/env node
/**
 * MCP server for DNSMint.
 *
 * The tool descriptions are the whole interface a model sees, so they carry
 * the rules the API enforces rather than leaving a model to discover them by
 * being refused: a hostname is one label above a domain, its address class is
 * fixed for life, and releasing one is permanent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ApiError, DnsmintClient } from "./client.js";

const apiKey = process.env.DNSMINT_API_KEY;
if (!apiKey) {
  console.error(
    "DNSMINT_API_KEY is required. Create a key at https://dnsmint.com/dashboard " +
      "with hostnames:read and hostnames:write, scoped to the domain this agent may use."
  );
  process.exit(1);
}

// Releasing is permanent, so it is off unless the operator turns it on. A
// model deciding to tidy up should not be able to burn a name forever.
const allowRelease = process.env.DNSMINT_ALLOW_RELEASE === "true";

const client = new DnsmintClient(apiKey, process.env.DNSMINT_API_URL);

const server = new McpServer({
  name: "dnsmint",
  version: "0.1.0",
});

/** Every tool answers in the same shape, so a refusal reads like a result. */
async function reply(work: () => Promise<unknown>) {
  try {
    const result = await work();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result ?? { ok: true }, null, 2) },
      ],
    };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? `DNSMint refused this: ${error.message}`
        : `Request failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

server.registerTool(
  "list_hostnames",
  {
    title: "List hostnames",
    description:
      "Every hostname this key can see, with how many are active and the plan's cap. " +
      "Check the cap before minting: a hostname is the unit the plan counts.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => reply(() => client.listHostnames())
);

server.registerTool(
  "get_hostname",
  {
    title: "Get a hostname",
    description:
      "One hostname's status and certificate mode. Does not say where it points: " +
      "DNS is the authoritative answer for that, so use diagnose_hostname or resolve the name.",
    inputSchema: { id: z.string().describe("The hostname's id, from list_hostnames.") },
    annotations: { readOnlyHint: true },
  },
  ({ id }) => reply(() => client.getHostname(id))
);

server.registerTool(
  "mint_hostname",
  {
    title: "Mint a hostname",
    description:
      "Register an address and get back a stable hostname that survives the address changing. " +
      "This is the tool to use when a machine or agent needs a name.\n\n" +
      "The address class is fixed for the life of the name: mint with a public address and it " +
      "stays public, mint with a private one and it stays private. Crossing later is refused, " +
      "so pass the address the machine will actually serve on.\n\n" +
      "A hostname is one label above a domain. Names below a hostname are not hostnames and " +
      "cannot be minted.\n\n" +
      "Newly minted names report status 'pending' and go 'live' within about a minute.",
    inputSchema: {
      ip: z
        .string()
        .optional()
        .describe("IPv4 or IPv6, public or private. One of ip or target is required."),
      target: z
        .string()
        .optional()
        .describe(
          "A platform endpoint to follow instead of a fixed address, when the platform gave " +
            "you a URL and no IP. DNSMint resolves it and serves ordinary A and AAAA records."
        ),
      subdomain: z
        .string()
        .optional()
        .describe("The label to use. Omitted, DNSMint picks an opaque one."),
      domain: z
        .string()
        .optional()
        .describe(
          "Which of the account's domains to mint on. Omitted, DNSMint picks when the account holds one."
        ),
      certificate: z
        .enum(["self", "csr", "managed"])
        .optional()
        .describe(
          "Who holds the private key. 'self' (default) means you run an ACME client. " +
            "'managed' means DNSMint gets and renews the certificate and you fetch it."
        ),
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  (input) => reply(() => client.mintHostname(input))
);

server.registerTool(
  "repoint_hostname",
  {
    title: "Repoint a hostname",
    description:
      "Point an existing hostname at a new address. This is what makes the name worth having: " +
      "the machine moves, the name does not, and everything holding the URL keeps working.\n\n" +
      "Repointing within an address class is free, including between IPv4 and IPv6. Crossing " +
      "between public and private is refused, because one name resolving public then private " +
      "is how DNS rebinding works.",
    inputSchema: {
      id: z.string().describe("The hostname's id, from list_hostnames."),
      ip: z.string().optional().describe("The new address."),
      target: z.string().optional().describe("A platform endpoint to follow instead."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  ({ id, ...rest }) => reply(() => client.repointHostname(id, rest))
);

server.registerTool(
  "diagnose_hostname",
  {
    title: "Diagnose a hostname",
    description:
      "Why a hostname is or is not working: what the nameservers answer, what public resolvers " +
      "see, and whether a certificate has been issued. Use this before assuming something is broken; " +
      "a name minted moments ago may simply not have propagated.",
    inputSchema: { id: z.string().describe("The hostname's id, from list_hostnames.") },
    annotations: { readOnlyHint: true },
  },
  ({ id }) => reply(() => client.diagnose(id))
);

if (allowRelease) {
  server.registerTool(
    "release_hostname",
    {
      title: "Release a hostname",
      description:
        "PERMANENTLY give up a hostname. Read this before calling it.\n\n" +
        "A released hostname is tombstoned and is never issued again, to anyone, including this " +
        "account. There is no undo and it cannot be re-minted. This is not like deleting a DNS " +
        "record.\n\n" +
        "Only call this when the name is genuinely finished with and a human has asked for it. " +
        "If the goal is to stop serving, repoint it or stop the machine instead.\n\n" +
        "Pass the hostname in `confirm` exactly as it appears, so a name cannot be released by " +
        "guessing an id.",
      inputSchema: {
        id: z.string().describe("The hostname's id, from list_hostnames."),
        confirm: z
          .string()
          .describe("The full hostname, exactly. Must match the name behind that id."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ id, confirm }) =>
      reply(async () => {
        const host = await client.getHostname(id);
        if (host.hostname !== confirm) {
          throw new Error(
            `confirm does not match: id ${id} is ${host.hostname}, not ${confirm}. ` +
              "Refusing to release a name that was not named exactly."
          );
        }
        await client.releaseHostname(id);
        return { released: host.hostname, permanent: true };
      })
  );
}

await server.connect(new StdioServerTransport());
