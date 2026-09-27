import { type GatewayDeps } from './gateway.handler';

export const GATEWAY_DEPS = Symbol('GATEWAY_DEPS');
export type GatewayRuntime = GatewayDeps;
