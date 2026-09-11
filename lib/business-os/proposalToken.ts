/**
 * The signed link a client opens to read and answer a proposal.
 *
 * Same mechanism as the booking-management token: a JWT naming exactly one
 * record, so a stranger with the link can act on that one thing and nothing
 * else. The client has no account and never will — a quote is often the first
 * contact a business has with them, and asking them to sign up to read a price
 * loses the job.
 *
 * The token IS the authorisation. Every route that accepts one must therefore
 * read the id out of the verified payload and never out of the URL or body.
 */

import * as jwt from 'jsonwebtoken';

const SECRET =
  process.env.BOOKING_TOKEN_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'dev-only-proposal-token-secret';

/**
 * Long, deliberately.
 *
 * A quote sits in an inbox while a client thinks, asks their partner, and
 * compares it with two others. A fortnight-long token would expire mid-decision
 * and turn a live deal into a broken link. `valid_until` on the proposal is
 * what actually governs whether it can still be accepted; this only bounds how
 * long the link itself works.
 */
const TOKEN_EXPIRY_DAYS = 180;

export interface ProposalTokenPayload {
  proposalId: string;
  email: string;
}

export function generateProposalToken(proposalId: string, email: string): string {
  return jwt.sign({ proposalId, email }, SECRET, { expiresIn: `${TOKEN_EXPIRY_DAYS}d` });
}

/** Null for anything tampered with, expired, or simply not one of ours. */
export function verifyProposalToken(token: string): ProposalTokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as ProposalTokenPayload;
    if (!decoded?.proposalId) return null;
    return decoded;
  } catch {
    return null;
  }
}
