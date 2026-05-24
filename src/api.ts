/**
 * PlayIt API Client
 *
 * Minimal HTTP client for the PlayIt.gg REST API.
 * All endpoints use POST with JSON bodies.
 * Authentication via: Authorization: Agent-Key <secret>
 * Base URL: https://api.playit.gg
 *
 * Type definitions derived from the open-source playit-agent Rust codebase:
 * https://github.com/playit-cloud/playit-agent/blob/master/packages/api_client/src/api.rs
 */

// ============================================================================
// Base API types
// ============================================================================

const API_BASE = "https://api.playit.gg";

export type PortType = "tcp" | "udp" | "both";

export type PlayitRegion =
  | "global"
  | "north-america"
  | "europe"
  | "asia"
  | "india"
  | "south-america";

/** Discriminated-union response envelope used by every PlayIt endpoint. */
type ApiResult<S, F> =
  | { status: "success"; data: S }
  | { status: "fail"; data: F }
  | { status: "error"; data: { type: string; message: string } };

// ============================================================================
// Tunnel request / response types (matching Rust struct names from api.rs)
// ============================================================================

export interface ReqTunnelsCreate {
  name: string | null;
  /** null = generic */
  tunnel_type: string | null;
  port_type: PortType;
  /** 1 for single-port, 3 for Valheim (2456-2458) */
  port_count: number;
  origin: TunnelOriginCreate;
  enabled: boolean;
  alloc: TunnelCreateUseAllocation | null;
  firewall_id: string | null;
  proxy_protocol: null;
}

export type TunnelOriginCreate =
  | { type: "default"; data: AssignedDefaultCreate }
  | { type: "agent"; data: AssignedAgentCreate };

export interface AssignedDefaultCreate {
  local_ip: string;
  local_port: number | null;
}

export interface AssignedAgentCreate {
  agent_id: string;
  local_ip: string;
  local_port: number | null;
}

export type TunnelCreateUseAllocation =
  | { type: "dedicated-ip"; details: { ip_hostname: string; port: number | null } }
  | { type: "port-allocation"; details: string }
  | { type: "region"; details: { region: PlayitRegion; port: number | null } };

export interface ObjectId {
  id: string;
}

export interface ReqTunnelsUpdate {
  tunnel_id: string;
  local_ip: string;
  local_port: number | null;
  agent_id: string | null;
  enabled: boolean;
}

export interface ReqTunnelsDelete {
  tunnel_id: string;
}

export interface ReqTunnelsList {
  tunnel_id: string | null;
  agent_id: string | null;
}

export interface AccountTunnel {
  id: string;
  name: string | null;
  port_type: PortType;
  port_count: number;
  active: boolean;
  alloc: unknown;
  origin: unknown;
}

export interface AccountTunnels {
  tunnels: AccountTunnel[];
}

// ============================================================================
// API client
// ============================================================================

export class PlayitApiError extends Error {
  constructor(
    public readonly kind: "fail" | "api-error" | "http-error" | "parse-error",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PlayitApiError";
  }
}

async function callApi<S, F = unknown>(
  apiKey: string,
  path: string,
  body: unknown,
): Promise<S> {
  const url = `${API_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Agent-Key ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new PlayitApiError("http-error", `Failed to reach ${url}: ${cause}`, cause);
  }

  let envelope: ApiResult<S, F>;
  try {
    envelope = (await response.json()) as ApiResult<S, F>;
  } catch (cause) {
    throw new PlayitApiError(
      "parse-error",
      `Failed to parse response from ${url} (HTTP ${response.status})`,
      cause,
    );
  }

  if (envelope.status === "success") {
    return envelope.data;
  }

  if (envelope.status === "fail") {
    throw new PlayitApiError(
      "fail",
      `PlayIt API returned fail for ${path}: ${JSON.stringify(envelope.data)}`,
      envelope.data,
    );
  }

  throw new PlayitApiError(
    "api-error",
    `PlayIt API error for ${path}: ${JSON.stringify(envelope.data)}`,
    envelope.data,
  );
}

// ============================================================================
// Exported CRUD functions
// ============================================================================

/**
 * Create a new tunnel. Returns the tunnel UUID on success.
 */
export async function createTunnel(
  apiKey: string,
  req: ReqTunnelsCreate,
): Promise<string> {
  const result = await callApi<ObjectId>(apiKey, "/tunnels/create", req);
  return result.id;
}

/**
 * Update an existing tunnel's local address / agent / enabled state.
 */
export async function updateTunnel(
  apiKey: string,
  req: ReqTunnelsUpdate,
): Promise<void> {
  await callApi<Record<string, never>>(apiKey, "/tunnels/update", req);
}

/**
 * Delete a tunnel by UUID. Treats TunnelNotFound as success (idempotent delete).
 */
export async function deleteTunnel(
  apiKey: string,
  tunnelId: string,
): Promise<void> {
  try {
    await callApi<Record<string, never>>(apiKey, "/tunnels/delete", {
      tunnel_id: tunnelId,
    } satisfies ReqTunnelsDelete);
  } catch (err) {
    if (
      err instanceof PlayitApiError &&
      err.kind === "fail" &&
      typeof err.detail === "string" &&
      err.detail === "TunnelNotFound"
    ) {
      // Already gone — treat as success
      return;
    }
    throw err;
  }
}

/**
 * List tunnels for the account, optionally filtering to a specific tunnel UUID.
 */
export async function listTunnels(
  apiKey: string,
  tunnelId: string | null,
): Promise<AccountTunnel[]> {
  const result = await callApi<AccountTunnels>(apiKey, "/tunnels/list", {
    tunnel_id: tunnelId,
    agent_id: null,
  } satisfies ReqTunnelsList);
  return result.tunnels;
}
