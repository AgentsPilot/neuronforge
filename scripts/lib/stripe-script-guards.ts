/**
 * Safety guards shared by the Business OS Stripe scripts (plan payments P-2b,
 * workplan §3.5; SA P2-C9, P1-C7).
 *
 *   - The key is read from an env FILE named by `--env`, parsed without
 *     touching `process.env`, and never printed, not even a prefix.
 *   - That file must lie OUTSIDE every git checkout (P2-C9): a key file inside
 *     a repo or worktree could be staged by `git add .` on a public repo. The
 *     check walks up from the file and refuses at the first `.git` it finds,
 *     which covers this repo, every worktree, and any other checkout.
 *   - The key's kind is checked before any network call; each script states
 *     which kinds it accepts.
 *   - `--expect-account acct_…` names the Stripe account the operator means.
 *     After one read-only call the script stops if the key belongs to another.
 *
 * A refusal throws `ScriptRefusal` (exit code 2). Nothing here calls Stripe
 * except `verifyAccount`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseEnv } from 'dotenv';

export type StripeKeyKind = 'sk_test' | 'rk_test' | 'sk_live' | 'rk_live';

/** A deliberate stop before (or instead of) doing anything. Exit code 2. */
export class ScriptRefusal extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'ScriptRefusal';
  }
}

export function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

export function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

/** The nearest ancestor directory (the file's own folder first) that holds `.git`, or `null`. */
export function enclosingGitCheckout(filePath: string): string | null {
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The env file to read the key from. `--env` is required, the file must exist,
 * and it must not lie inside a git checkout or under the current directory.
 */
export function resolveEnvFile(argv: readonly string[], cwd: string = process.cwd()): string {
  const given = argValue(argv, '--env');
  if (!given) {
    throw new ScriptRefusal(
      '--env <file> is required: a file OUTSIDE the repo holding one line STRIPE_SECRET_KEY=... (P2-C9)'
    );
  }
  const file = path.resolve(cwd, given);
  const relativeToCwd = path.relative(path.resolve(cwd), file);
  if (!relativeToCwd.startsWith('..') && !path.isAbsolute(relativeToCwd)) {
    throw new ScriptRefusal('--env points inside the current directory; keep the key file outside every repo (P2-C9)');
  }
  const checkout = enclosingGitCheckout(file);
  if (checkout) {
    throw new ScriptRefusal(`--env points inside a git checkout (${checkout}); keep the key file outside every repo (P2-C9)`);
  }
  if (!fs.existsSync(file)) throw new ScriptRefusal(`--env file not found: ${file}`);
  return file;
}

/** `STRIPE_SECRET_KEY` from the file, or '' when absent. Leaves `process.env` alone. */
export function readStripeKey(envFile: string): string {
  const parsed = parseEnv(fs.readFileSync(envFile));
  return (parsed.STRIPE_SECRET_KEY ?? '').trim();
}

export function stripeKeyKind(key: string): StripeKeyKind | null {
  for (const kind of ['sk_test', 'rk_test', 'sk_live', 'rk_live'] as const) {
    if (key.startsWith(`${kind}_`)) return kind;
  }
  return null;
}

/** The key's kind, if allowed. Never echoes the key. */
export function assertKeyKind(key: string, allowed: readonly StripeKeyKind[]): StripeKeyKind {
  const kind = stripeKeyKind(key);
  if (!kind) throw new ScriptRefusal('STRIPE_SECRET_KEY is missing or is not a Stripe secret or restricted key');
  if (!allowed.includes(kind)) {
    throw new ScriptRefusal(`this script accepts only ${allowed.join(', ')} keys; the key given is ${kind}`);
  }
  return kind;
}

export function isLiveKind(kind: StripeKeyKind): boolean {
  return kind === 'sk_live' || kind === 'rk_live';
}

/** `--expect-account acct_…`, required. */
export function requireExpectedAccount(argv: readonly string[]): string {
  const value = argValue(argv, '--expect-account');
  if (!value) throw new ScriptRefusal('--expect-account acct_... is required: the Stripe account you mean to use');
  if (!/^acct_[A-Za-z0-9]+$/.test(value)) throw new ScriptRefusal('--expect-account must look like acct_...');
  return value;
}

export interface AccountReader {
  accounts: {
    retrieveCurrent(): Promise<{ id: string; settings?: { dashboard?: { display_name?: string | null } | null } | null }>;
  };
}

/** One read-only call. Stops when the key belongs to another account. */
export async function verifyAccount(
  stripe: AccountReader,
  expected: string
): Promise<{ id: string; displayName: string }> {
  const account = await stripe.accounts.retrieveCurrent();
  const displayName = account.settings?.dashboard?.display_name ?? '(no display name)';
  if (account.id !== expected) {
    throw new ScriptRefusal(`the key belongs to ${account.id} (${displayName}), not ${expected}; nothing was done`);
  }
  return { id: account.id, displayName };
}

/**
 * Removes anything shaped like a Stripe key from a message. Stripe's own
 * "Invalid API Key provided" error echoes a masked key; print none of it.
 */
export function redactKeys(message: string): string {
  return message.replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+/g, '<redacted key>');
}

/** Runs `main`, mapping a refusal to exit 2 and any other failure to exit 1. */
export function runScript(main: () => Promise<number | void>, out: (line: string) => void): void {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err: unknown) => {
      if (err instanceof ScriptRefusal) {
        out(`Refusing: ${redactKeys(err.message)}`);
        process.exit(err.exitCode);
      }
      out(`failed: ${redactKeys(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
