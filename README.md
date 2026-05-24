# @kubedoll/pulumi-playit

> **Status: alpha / unstable API — expect breakage between versions.**

Pulumi dynamic resource for declarative [PlayIt.gg](https://playit.gg) tunnel management.

PlayIt.gg provides free reverse-proxy tunnels for game servers (and many other TCP/UDP workloads). This package manages tunnels as first-class Pulumi resources so they can be declared alongside the workloads that need them and tracked in your stack state with full create / update / delete lifecycle.

## How it works

The PlayIt agent running in your environment (typically a Kubernetes pod or a process on a host) connects to the PlayIt relay network and receives forwarding rules from the API. This package writes those forwarding rules via the PlayIt REST API. The agent picks them up automatically — no restart or config reload needed.

## Installation

```sh
pnpm add @kubedoll/pulumi-playit
# or
npm install @kubedoll/pulumi-playit
```

Peer dependency: `@pulumi/pulumi ^3.0.0`

## Auth setup

1. Generate an API key at [playit.gg/account/settings](https://playit.gg/account/settings) under **API Keys**. The key needs at minimum tunnel read + write scope; full access is simpler.

2. Store the key safely. Options:
   - `pulumi.secret(process.env.PLAYIT_API_KEY!)` — inject via CI env var
   - `pulumi config set --secret playitApiKey <key>` — store in Pulumi ESC / stack config
   - A secrets manager (1Password, AWS SSM, etc.) — read with the appropriate Pulumi provider

3. Pass the key to every `PlayitTunnel` resource via the `apiKey` property. It is automatically marked as a Pulumi secret and never written to state in plaintext.

## Usage

```typescript
import * as pulumi from '@pulumi/pulumi';
import { PlayitTunnel } from '@kubedoll/pulumi-playit';

const config = new pulumi.Config();
const apiKey = config.requireSecret('playitApiKey');

// Single-port TCP tunnel (Terraria, Minecraft Java, etc.)
const terrariaTunnel = new PlayitTunnel('terraria', {
  apiKey,
  name: 'terraria',
  portType: 'tcp',
  localAddress: '10.96.50.10:7777', // or a resolvable hostname
});

export const terrariaTunnelId = terrariaTunnel.tunnelId;

// Multi-port UDP tunnel (Valheim: ports 2456-2458)
const valheimTunnel = new PlayitTunnel('valheim', {
  apiKey,
  name: 'valheim',
  portType: 'udp',
  portCount: 3,
  localAddress: '10.96.50.20:2456',
});

// Both TCP and UDP on a single port (Vintage Story)
const vintageStoryTunnel = new PlayitTunnel('vintage-story', {
  apiKey,
  name: 'vintage-story',
  portType: 'both',
  localAddress: '10.96.50.30:42420',
});
```

### Kubernetes in-cluster usage

When the PlayIt agent runs as a Kubernetes pod, use the Kubernetes service DNS name as `localAddress`. The name is resolved to a ClusterIP at Pulumi deploy time (from wherever `pulumi up` runs — typically your laptop or CI):

```typescript
const tunnel = new PlayitTunnel('my-game', {
  apiKey,
  name: 'my-game',
  portType: 'tcp',
  // Resolved at deploy time — must be reachable from the machine running pulumi up.
  // If you are deploying from outside the cluster you must use the ClusterIP directly,
  // or use a LoadBalancer/NodePort service instead.
  localAddress: 'my-game.default.svc.cluster.local:25565',
});
```

### Agent UUID (optional)

For single-agent accounts the default agent is used automatically. For multi-agent setups, pin the tunnel to a specific agent:

```typescript
const config = new pulumi.Config();
const agentId = config.get('playitAgentId'); // optional

const tunnel = new PlayitTunnel('my-game', {
  apiKey,
  agentId,          // omit to use account default
  name: 'my-game',
  portType: 'tcp',
  localAddress: '10.0.0.5:25565',
});
```

Find your agent UUID in the PlayIt dashboard under **Agents**, or in the agent logs on first startup.

### Premium features

```typescript
// Pin to a region (premium accounts)
const tunnel = new PlayitTunnel('eu-server', {
  apiKey,
  name: 'eu-server',
  portType: 'tcp',
  localAddress: '10.0.0.5:25565',
  region: 'europe',
});

// Use a reserved port allocation (premium accounts)
const tunnel2 = new PlayitTunnel('reserved-port', {
  apiKey,
  name: 'reserved-port',
  portType: 'tcp',
  localAddress: '10.0.0.5:25565',
  portAllocationId: '<allocation-uuid-from-dashboard>',
});
```

## Resource lifecycle

| Operation | Behavior |
|-----------|----------|
| `create` | Calls `/tunnels/create`, stores the tunnel UUID in state |
| `update` | Calls `/tunnels/update` for address/agent changes; replaces (delete + create) for `portType`, `portCount`, `portAllocationId` changes |
| `delete` | Calls `/tunnels/delete`; treats `TunnelNotFound` as success (idempotent) |
| `refresh` | Calls `/tunnels/list` to check existence; marks deleted if not found |

## Caveats

1. **DNS resolution at deploy time.** The PlayIt API requires an IP address, not a hostname. `localAddress` hostnames are resolved during `pulumi up` on the machine running Pulumi. If you deploy from outside a Kubernetes cluster and use `svc.cluster.local` names, resolution will fail. Use the service's ClusterIP or a DNS name reachable from your deploy environment (LoadBalancer IP, NodePort, etc.).

2. **Multi-port tunnels require a premium account.** `portCount > 1` (e.g. Valheim's 3-port UDP range) requires a PlayIt premium subscription. The API will return an error if you attempt this on a free account.

3. **`portType: 'both'` allocates a single port for both TCP and UDP.** This is correct for games like Vintage Story that use the same port number for both protocols. It is not the same as allocating two separate ports.

4. **The agent must be registered before tunnels are useful.** This resource only manages the SaaS-side tunnel record. The agent pod/process must already be running and registered with your PlayIt account before it can forward traffic. The tunnel will appear in the dashboard immediately but will show as "offline" until the agent connects.

## Contributing

Issues and PRs welcome. This is an alpha project — the API surface may change.

## License

MIT — see [LICENSE](./LICENSE).
