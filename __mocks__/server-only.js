/**
 * `server-only` under Jest.
 *
 * The real package is a build-time guard: importing it from a client bundle is
 * meant to fail the build. Next.js resolves it internally, so it is not in
 * node_modules — and Jest, which does not, cannot resolve it at all. Three test
 * suites stopped running the moment a module deep in their import chain started
 * importing it.
 *
 * An empty module is the correct stand-in: the guard has nothing to do in a test
 * run, which is server-side by definition.
 */
module.exports = {};
