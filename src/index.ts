/**
 * @kubedoll/pulumi-playit
 *
 * Pulumi dynamic resource for declarative PlayIt.gg tunnel management.
 *
 * PlayIt.gg provides free reverse-proxy tunnels for game servers (and more).
 * This package manages tunnels as first-class Pulumi resources so they can be
 * declared alongside the workloads that use them and tracked in your stack state.
 *
 * The PlayIt agent running in your environment picks up new tunnels automatically
 * via the PlayIt API — no restart or config reload is needed.
 *
 * @example
 * ```typescript
 * import * as pulumi from '@pulumi/pulumi';
 * import { PlayitTunnel } from '@kubedoll/pulumi-playit';
 *
 * const config = new pulumi.Config();
 * const apiKey = config.requireSecret('playitApiKey');
 *
 * const tunnel = new PlayitTunnel('my-server', {
 *   apiKey,
 *   name: 'my-server',
 *   portType: 'tcp',
 *   localAddress: '10.96.50.10:25565',
 * });
 *
 * export const tunnelId = tunnel.tunnelId;
 * ```
 */

export { PlayitTunnel, playitTunnelSchema } from "./tunnel.js";
export type { PlayitTunnelConfig } from "./tunnel.js";
export { PlayitApiError } from "./api.js";
export type { PortType, PlayitRegion, AccountTunnel } from "./api.js";
