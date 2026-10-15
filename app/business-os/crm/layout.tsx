import '../../v2/globals-v2.css';

/*
 * No LanguageProvider here (performance business round BR-1a, SA C-1).
 *
 * This layout used to mount a SECOND one inside the Business OS layout's. Being
 * a client layout it could not receive the server-read language, so every CRM
 * page kept the English first frame; it also held its own state, so a switch
 * from the header did not reach CRM content, and it repeated the preferences
 * request (and, with nothing saved, the backfill). CRM pages use the Business
 * OS layout's provider now.
 *
 * No V2ThemeProvider either (TH-1, SA Q-1), for the same kind of reason: the
 * Business OS layout above already mounts one, nothing under CRM reads the
 * inner context, the inner one repeated the custom-token read, and its stale
 * `mode` could revert a toggle. With no provider left, this is a server layout
 * that only adds the `/v2` stylesheet.
 */

export default function CRMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
