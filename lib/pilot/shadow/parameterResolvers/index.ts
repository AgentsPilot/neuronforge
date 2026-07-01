/**
 * Parameter-resolver registry (Calibration Option A).
 *
 * A tiny static registry keyed by `${plugin}.${action}.${parameter}` (SA § 6 Q1).
 * Resolvers are co-located under this folder and registered here. The generic
 * engine looks them up; it never hardcodes any plugin knowledge.
 *
 * Phase 1 ships the registry with NO resolvers registered — the Google Sheets
 * range resolver is added in Phase 2. Tests register mock resolvers directly.
 */

import type { ParameterResolver } from './types';

export type ResolverKey = string; // `${plugin}.${action}.${parameter}`

export function resolverKey(plugin: string, action: string, parameter: string): ResolverKey {
  return `${plugin}.${action}.${parameter}`;
}

export class ParameterResolverRegistry {
  private readonly resolvers = new Map<ResolverKey, ParameterResolver>();

  register(resolver: ParameterResolver): this {
    this.resolvers.set(resolverKey(resolver.plugin, resolver.action, resolver.parameter), resolver);
    return this;
  }

  lookup(plugin: string, action: string, parameter: string): ParameterResolver | undefined {
    return this.resolvers.get(resolverKey(plugin, action, parameter));
  }

  size(): number {
    return this.resolvers.size;
  }
}

/**
 * The default registry used by the calibration route. Register real resolvers
 * here as they're built (Phase 2 will add the Google Sheets range resolver):
 *
 *   import { googleSheetsRangeResolver } from './googleSheetsRange';
 *   defaultParameterResolverRegistry.register(googleSheetsRangeResolver);
 */
export const defaultParameterResolverRegistry = new ParameterResolverRegistry();
