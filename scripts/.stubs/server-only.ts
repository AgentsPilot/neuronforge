/**
 * A stand-in for Next's `server-only` guard, for command-line scripts.
 *
 * The real module is not a package: Next swaps it in at build time, and its
 * whole job is to fail the build if a server module is imported from a client
 * component. Outside Next it does not resolve at all, so importing any server
 * service from `tsx` dies with "Cannot find module 'server-only'" before a line
 * of the service runs.
 *
 * Empty on purpose. A script running under tsx IS the server, so there is
 * nothing to guard against, and mapping it here keeps the guard intact
 * everywhere it actually matters.
 */
export {};
