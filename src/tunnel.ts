/**
 * PlayitTunnel — Pulumi Dynamic Resource
 *
 * Manages a PlayIt.gg tunnel as a first-class Pulumi resource with proper
 * create / read / update / delete lifecycle. Tunnels are SaaS-side config;
 * the in-cluster playit-agent picks them up automatically once registered.
 *
 * Authentication:
 *   Provide your PlayIt API key via the `apiKey` property. The key is marked
 *   as a Pulumi secret so it never appears in plaintext state.
 *
 * Local address semantics:
 *   The PlayIt agent routes public traffic to the in-cluster host:port pair you
 *   specify in `localAddress`. Use a fully-qualified Kubernetes service DNS name:
 *
 *     <svc-name>.<namespace>.svc.cluster.local:<port>
 *
 *   The agent resolves the hostname at runtime from the node where the agent pod
 *   runs — no DNS lookup is performed during `pulumi up`. You can safely pass
 *   cluster-internal DNS names (svc.cluster.local) even when deploying from
 *   outside the cluster.
 *
 * Agent ID:
 *   Pass the agent UUID returned by the PlayIt dashboard (or discovered via
 *   the RunData API). When omitted the API uses the account's default agent,
 *   which is correct for single-agent setups.
 */

import * as pulumi from "@pulumi/pulumi";
import { type } from "arktype";

import {
  createTunnel,
  deleteTunnel,
  listTunnels,
  updateTunnel,
  type AssignedAgentCreate,
  type ReqTunnelsCreate,
  type TunnelOriginCreate,
} from "./api.js";

// ============================================================================
// Schema
// ============================================================================

export const playitTunnelSchema = type({
  /** PlayIt API key. Treat as a Pulumi secret. */
  apiKey: "string",

  /** Display name for the tunnel in the PlayIt dashboard. */
  name: "string",

  /**
   * Protocol type for the tunnel.
   * - 'tcp'  — TCP only (Terraria, Minecraft Java, Vintage Story)
   * - 'udp'  — UDP only (Valheim primary game port if split)
   * - 'both' — TCP + UDP (Vintage Story, generic game servers)
   */
  portType: "'tcp' | 'udp' | 'both'",

  /**
   * Number of consecutive ports to allocate.
   * Defaults to 1. Valheim requires 3 (ports 2456-2458 UDP).
   */
  "portCount?": "number",

  /**
   * Local target address: "hostname:port" or "ip:port".
   * Resolved at deploy time for the API call; the agent handles runtime routing.
   * Example: "terraria-terraria-tshock.steam.svc.cluster.local:7777"
   */
  localAddress: "string",

  /**
   * PlayIt agent UUID. When omitted, the account's default agent is used.
   * Find it in the PlayIt dashboard under Agents, or from the agent's logs
   * on first startup (it logs its own UUID after registration).
   */
  "agentId?": "string",

  /**
   * Premium: pin the tunnel to a specific region.
   * Available values: "global" | "north-america" | "europe" | "asia" |
   *                   "india" | "south-america"
   */
  "region?": "'global' | 'north-america' | 'europe' | 'asia' | 'india' | 'south-america'",

  /**
   * Premium: request a specific port allocation UUID.
   * Use the PlayIt dashboard to reserve ports and copy the allocation UUID.
   */
  "portAllocationId?": "string",
});

export type PlayitTunnelConfig = typeof playitTunnelSchema.infer;

// ============================================================================
// Dynamic provider inputs / outputs
// ============================================================================

/** Inputs stored in Pulumi state (serializable values only). */
interface TunnelInputs {
  apiKey: string;
  name: string;
  portType: "tcp" | "udp" | "both";
  portCount: number;
  localAddress: string;
  agentId?: string;
  region?: string;
  portAllocationId?: string;
}

/** Outputs enriched with the created tunnel's UUID. */
interface TunnelOutputs extends TunnelInputs {
  tunnelId: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse "host:port" into constituent parts.
 * Throws if the address does not contain exactly one colon (after bracket handling).
 */
function parseAddress(address: string): { host: string; port: number } {
  // Handle IPv6 bracket notation: [::1]:7777
  const ipv6Match = address.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match && ipv6Match[1] !== undefined && ipv6Match[2] !== undefined) {
    return { host: ipv6Match[1], port: Number(ipv6Match[2]) };
  }
  const lastColon = address.lastIndexOf(":");
  if (lastColon === -1) {
    throw new Error(
      `Invalid localAddress "${address}": expected "hostname:port" or "ip:port"`,
    );
  }
  const host = address.slice(0, lastColon);
  const port = Number(address.slice(lastColon + 1));
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in localAddress "${address}"`);
  }
  return { host, port };
}

function buildCreateRequest(inputs: TunnelInputs): ReqTunnelsCreate {
  const { host, port } = parseAddress(inputs.localAddress);

  const origin: TunnelOriginCreate = inputs.agentId
    ? {
        type: "agent",
        data: {
          agent_id: inputs.agentId,
          local_ip: host,
          local_port: port,
        } satisfies AssignedAgentCreate,
      }
    : {
        type: "default",
        data: {
          local_ip: host,
          local_port: port,
        },
      };

  const alloc =
    inputs.portAllocationId
      ? { type: "port-allocation" as const, details: inputs.portAllocationId }
      : inputs.region
      ? { type: "region" as const, details: { region: inputs.region as never, port: null } }
      : null;

  return {
    name: inputs.name,
    tunnel_type: null,
    port_type: inputs.portType,
    port_count: inputs.portCount,
    origin,
    enabled: true,
    alloc,
    firewall_id: null,
    proxy_protocol: null,
  };
}

// ============================================================================
// Dynamic Resource Provider
// ============================================================================

const playitTunnelProvider: pulumi.dynamic.ResourceProvider = {
  // ------------------------------------------------------------------
  // create
  // ------------------------------------------------------------------
  async create(inputs: TunnelInputs): Promise<pulumi.dynamic.CreateResult> {
    const req = buildCreateRequest(inputs);
    const tunnelId = await createTunnel(inputs.apiKey, req);

    const outs: TunnelOutputs = { ...inputs, tunnelId };
    return { id: tunnelId, outs };
  },

  // ------------------------------------------------------------------
  // read  (used by `pulumi refresh`)
  // ------------------------------------------------------------------
  async read(id: string, props: TunnelOutputs): Promise<pulumi.dynamic.ReadResult> {
    const tunnels = await listTunnels(props.apiKey, id);
    const tunnel = tunnels.find((t) => t.id === id);

    if (!tunnel) {
      // Tunnel was deleted out-of-band — signal Pulumi to treat as deleted
      return { id: "", props: {} };
    }

    return { id, props };
  },

  // ------------------------------------------------------------------
  // diff  (decide whether an update is needed)
  // ------------------------------------------------------------------
  async diff(
    _id: string,
    olds: TunnelOutputs,
    news: TunnelInputs,
  ): Promise<pulumi.dynamic.DiffResult> {
    const replaces: string[] = [];
    const changes: string[] = [];

    // Changing protocol type or port count requires delete + recreate
    if (olds.portType !== news.portType) replaces.push("portType");
    if ((olds.portCount ?? 1) !== (news.portCount ?? 1)) replaces.push("portCount");

    // In-place updatable fields
    if (olds.localAddress !== news.localAddress) changes.push("localAddress");
    if (olds.name !== news.name) changes.push("name");
    if (olds.agentId !== news.agentId) changes.push("agentId");
    if (olds.region !== news.region) changes.push("region");
    if (olds.portAllocationId !== news.portAllocationId) replaces.push("portAllocationId");

    return {
      changes: replaces.length > 0 || changes.length > 0,
      replaces,
      deleteBeforeReplace: true,
    };
  },

  // ------------------------------------------------------------------
  // update  (in-place update of local address / agent / enabled state)
  // ------------------------------------------------------------------
  async update(id: string, _olds: TunnelOutputs, news: TunnelInputs): Promise<pulumi.dynamic.UpdateResult> {
    const { host, port } = parseAddress(news.localAddress);

    await updateTunnel(news.apiKey, {
      tunnel_id: id,
      local_ip: host,
      local_port: port,
      agent_id: news.agentId ?? null,
      enabled: true,
    });

    const outs: TunnelOutputs = { ...news, tunnelId: id };
    return { outs };
  },

  // ------------------------------------------------------------------
  // delete
  // ------------------------------------------------------------------
  async delete(id: string, props: TunnelOutputs): Promise<void> {
    await deleteTunnel(props.apiKey, id);
  },
};

// ============================================================================
// PlayitTunnel Resource
// ============================================================================

/**
 * A PlayIt.gg tunnel managed as a Pulumi resource.
 *
 * Creates, updates, and deletes tunnels via the PlayIt REST API.
 * The running in-cluster playit-agent picks up the tunnel automatically.
 *
 * @example
 * ```typescript
 * import { PlayitTunnel } from '@kubedoll/pulumi-playit';
 *
 * const terrariaTunnel = new PlayitTunnel('terraria-tunnel', {
 *   apiKey: pulumi.secret(process.env.PLAYIT_API_KEY!),
 *   name: 'terraria',
 *   portType: 'tcp',
 *   localAddress: 'terraria.steam.svc.cluster.local:7777',
 * });
 * ```
 */
export class PlayitTunnel extends pulumi.dynamic.Resource {
  /**
   * The PlayIt-assigned tunnel UUID.
   * Use this to correlate with the PlayIt dashboard.
   */
  public readonly tunnelId!: pulumi.Output<string>;

  constructor(
    name: string,
    args: {
      /** PlayIt API key. Wrap in pulumi.secret() or read from a secrets manager. */
      apiKey: pulumi.Input<string>;
      /** Display name for the tunnel in the PlayIt dashboard. */
      name: pulumi.Input<string>;
      /** Protocol type: 'tcp', 'udp', or 'both'. */
      portType: pulumi.Input<"tcp" | "udp" | "both">;
      /**
       * Number of consecutive ports. Defaults to 1.
       * Valheim requires 3 (2456-2458).
       */
      portCount?: pulumi.Input<number>;
      /**
       * Local target: "hostname:port".
       * Example: "valheim.steam.svc.cluster.local:2456"
       */
      localAddress: pulumi.Input<string>;
      /**
       * PlayIt agent UUID (optional — defaults to the account default agent).
       * Find in PlayIt dashboard under Agents.
       */
      agentId?: pulumi.Input<string>;
      /** Premium: region hint for the public endpoint. */
      region?: pulumi.Input<"global" | "north-america" | "europe" | "asia" | "india" | "south-america">;
      /** Premium: reserved port allocation UUID from the PlayIt dashboard. */
      portAllocationId?: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      playitTunnelProvider,
      name,
      {
        // Map to provider input names
        apiKey: args.apiKey,
        name: args.name,
        portType: args.portType,
        portCount: args.portCount ?? 1,
        localAddress: args.localAddress,
        agentId: args.agentId,
        region: args.region,
        portAllocationId: args.portAllocationId,
        // Output — set to undefined so Pulumi knows provider fills it
        tunnelId: undefined,
      },
      {
        ...opts,
        // Mark apiKey as always secret in state
        additionalSecretOutputs: ["apiKey"],
      },
    );
  }
}
