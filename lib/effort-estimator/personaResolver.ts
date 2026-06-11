/**
 * Effort Estimator — persona resolver.
 *
 * Maps `UserContext` (domain + role from auth metadata) into a single persona
 * string used in the LLM system prompt. The LLM is instructed to reference the
 * persona by name inside its `reasoning` field (AC-3); after the call the
 * estimator scans the reasoning for the persona's role/domain keywords. The
 * scan is intentionally lenient — see `verifyReasoningMentionsPersona`.
 */
import type { UserContext } from '@/lib/user-context';

/**
 * Resolve a persona string from user context fields.
 *
 *  - domain + role → "{role} at a {domain} SMB"
 *  - domain only   → "SMB owner in {domain}"
 *  - role only     → "{role} at an SMB"
 *  - neither       → "generic SMB owner"
 */
export function resolvePersona(userContext: UserContext): string {
  const domain = userContext.domain?.trim();
  const role = userContext.role?.trim();

  if (domain && role) return `${role} at a ${domain} SMB`;
  if (domain) return `SMB owner in ${domain}`;
  if (role) return `${role} at an SMB`;
  return 'generic SMB owner';
}

/**
 * Lenient scan: does the LLM's `reasoning` field reference the chosen persona
 * by role or domain keyword?
 *
 * Per SA Observation #4 (SA Phase-1 comment #8): use role-OR-domain substring
 * scan, NOT full persona-string match. LLM paraphrasing — e.g. "as a
 * logistics-ops manager I would..." — is common and a strict full-string
 * match was rejecting valid responses. We therefore accept the response if
 * either the role token OR the domain token appears in the reasoning.
 *
 * For the generic-SMB-owner fallback we accept any mention of "smb",
 * "small business", or "owner" — same intent.
 *
 * @returns true if the reasoning plausibly mentions the persona, false otherwise.
 */
export function verifyReasoningMentionsPersona(reasoning: string, userContext: UserContext): boolean {
  const haystack = reasoning.toLowerCase();
  const domain = userContext.domain?.trim().toLowerCase();
  const role = userContext.role?.trim().toLowerCase();

  if (!domain && !role) {
    // Generic fallback — accept any plausible SMB-owner reference.
    return haystack.includes('smb') || haystack.includes('small business') || haystack.includes('owner');
  }

  if (role && haystack.includes(role)) return true;
  if (domain && haystack.includes(domain)) return true;
  return false;
}
