/**
 * Contact, by smart-link code: /c/{userCode}/contact
 *
 * The page itself is `components/public/PublicContactPage`, shared with the
 * business's own address (`joesgym.agentspilot.ai/contact`). Two routes, one
 * implementation — the alternative is what happened to the booking page, which
 * exists twice and has been drifting apart since.
 */

import { Metadata } from 'next';
import { PublicContactPage, publicContactMetadata } from '@/components/public/PublicContactPage';

interface PageProps {
  params: Promise<{ userCode: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userCode } = await params;
  return publicContactMetadata(userCode);
}

export default async function StandaloneContactPage({ params }: PageProps) {
  const { userCode } = await params;
  return <PublicContactPage userCode={userCode} />;
}
