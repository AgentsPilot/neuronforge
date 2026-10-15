/**
 * The one way a person's data export is downloaded from the browser.
 *
 * Three settings screens each built their own export by reading `profiles`,
 * `user_preferences`, `notification_settings` and `plugin_connections` with
 * `select('*')` straight from the browser — which put every connected plugin's
 * `access_token` and `refresh_token` in the downloaded file (DE-0a,
 * BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.1.3). This asks the server export,
 * `GET /api/user/data-export`, which names its columns, never reads
 * credentials, and writes the `DATA_EXPORTED` audit event itself.
 *
 * Fetch + Blob rather than a plain link (SQ-E2): a link cannot tell the screen
 * whether the download worked, so a signed-out person would get an error JSON
 * saved as their "data" and a success message. Returns a verdict rather than
 * throwing, so each screen keeps its own loading state and messages.
 *
 * No user id parameter on purpose: the server takes the person from the
 * session cookie, so this cannot be pointed at anybody else.
 */

export const USER_DATA_EXPORT_URL = '/api/user/data-export';

export type DownloadUserDataExportResult =
  | { success: true; filename: string }
  | {
      success: false;
      /** HTTP status when the server answered; absent on a network failure. */
      status?: number;
      code: 'unauthorized' | 'server_error' | 'network';
    };

/** Today's date as `YYYY-MM-DD`, for the fallback filename. */
function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * The filename the server put in `Content-Disposition`, or the pattern the
 * Business OS settings screen has always used. Only a bare filename is kept —
 * anything with a path separator is ignored rather than trusted.
 */
export function filenameFromContentDisposition(header: string | null): string {
  const fallback = `my-data-${today()}.json`;
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  if (!name || /[\\/]/.test(name)) return fallback;
  return name;
}

export async function downloadUserDataExport(): Promise<DownloadUserDataExportResult> {
  let response: Response;
  try {
    response = await fetch(USER_DATA_EXPORT_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return { success: false, code: 'network' };
  }

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      code: response.status === 401 ? 'unauthorized' : 'server_error',
    };
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    // The body was cut off part-way; saving half a file would be worse than
    // saying it failed.
    return { success: false, status: response.status, code: 'network' };
  }

  const filename = filenameFromContentDisposition(response.headers.get('Content-Disposition'));
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }

  return { success: true, filename };
}
