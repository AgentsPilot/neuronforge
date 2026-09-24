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

/**
 * Fatal when unset, for the reason given in `BookingEmailService`: the token is
 * the authorisation, and a proposal link signed with a string from this
 * repository could be minted by anyone for any proposal. These links live 180
 * days, so a forgeable one stays forgeable for six months.
 */
function secret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign proposal links'
    );
  }

  return configured;
}

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
  return jwt.sign({ proposalId, email }, secret(), { expiresIn: `${TOKEN_EXPIRY_DAYS}d` });
}

/** Null for anything tampered with, expired, or simply not one of ours. */
export function verifyProposalToken(token: string): ProposalTokenPayload | null {
  // Outside the try: a missing secret is a misconfiguration, not a bad token,
  // and returning `null` for it would tell every client with a valid link that
  // their link was invalid while nothing said why.
  const key = secret();

  try {
    const decoded = jwt.verify(token, key) as ProposalTokenPayload;
    if (!decoded?.proposalId) return null;
    return decoded;
  } catch {
    return null;
  }
}
