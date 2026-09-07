/** A thin client for the DNSMint hostname API. */

const DEFAULT_BASE_URL = "https://dnsmint.com/api/v1";

export interface Hostname {
  id: string;
  hostname: string;
  status: string;
  certificate: string;
  created_at: string;
}

/**
 * An API refusal, carrying what the API said.
 *
 * The message is the whole value here. A model that reads "This API key's
 * dns01:write scope is limited to other.example.dev" can explain the problem
 * or pick a different name; one that reads "HTTP 403" will retry the same call.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class DnsmintClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const raw = await response.text();
      let message = raw.trim();
      let code: string | undefined;
      try {
        const parsed = JSON.parse(raw) as { error?: string; code?: string };
        if (parsed.error) message = parsed.error;
        code = parsed.code;
      } catch {
        // A non-JSON body is still worth reporting verbatim.
      }
      throw new ApiError(response.status, message, code);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async listHostnames(): Promise<{
    hostnames: Hostname[];
    total: number;
    active: number;
    cap: number;
  }> {
    return this.request("GET", "/hostnames?limit=500");
  }

  async getHostname(id: string): Promise<Hostname> {
    return this.request("GET", `/hostnames/${encodeURIComponent(id)}`);
  }

  async mintHostname(input: {
    ip?: string;
    target?: string;
    subdomain?: string;
    domain?: string;
    certificate?: string;
    ca?: string;
  }): Promise<Hostname> {
    return this.request("POST", "/hostnames", input);
  }

  async repointHostname(
    id: string,
    input: { ip?: string; target?: string }
  ): Promise<Hostname> {
    return this.request("PUT", `/hostnames/${encodeURIComponent(id)}`, input);
  }

  async releaseHostname(id: string): Promise<void> {
    await this.request("DELETE", `/hostnames/${encodeURIComponent(id)}`);
  }

  async diagnose(id: string): Promise<unknown> {
    return this.request("GET", `/hostnames/${encodeURIComponent(id)}/diagnose`);
  }
}
