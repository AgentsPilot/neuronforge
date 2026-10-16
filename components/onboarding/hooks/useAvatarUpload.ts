import { useState, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import { createLogger } from '@/lib/logger';
import { AVATAR_MAX_BYTES, isAvatarMimeType } from '@/lib/validation/avatar';

/*
 * The profile picture, through `POST` / `DELETE /api/user/avatar` (settings
 * drawer D-3, C-21). This hook used to read and write `profiles` and the
 * `avatars` bucket from the browser; the server now owns all of it, decides
 * the file type from its bytes and deletes an old file only when it is proven
 * to be this account's.
 *
 * The public shape is unchanged: `uploadAvatar(file) -> url | null`,
 * `deleteAvatar() -> boolean`, plus `uploading` / `error` / `progress`.
 *
 * The pre-check below is a convenience (no request for a file the server
 * would refuse); the server decides. Messages are this hook's own English
 * sentences, chosen from the route's `code`: a server's text is never shown.
 * Logs carry a status, a code or the thrown error only, never a file name or
 * a URL (L-1).
 */

const logger = createLogger({ module: 'useAvatarUpload' });

const AVATAR_ROUTE = '/api/user/avatar';

const MESSAGES = {
  notAuthenticated: 'User not authenticated',
  fileType: 'Please choose a PNG, JPEG, WebP or GIF image',
  fileTooLarge: 'Image must be 4 MB or smaller',
  signInAgain: 'Please sign in again',
  uploadFailed: 'Failed to upload the picture',
  removeFailed: 'Failed to remove the picture',
} as const;

interface AvatarUploadState {
  uploading: boolean;
  error: string | null;
  progress: number;
}

interface AvatarRouteBody {
  code?: string;
  avatarUrl?: string;
}

/** The route's JSON, read defensively: a platform 413 (Vercel) is not JSON. */
async function readBody(response: Response): Promise<AvatarRouteBody> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return {};
    const { code, data } = body as { code?: unknown; data?: unknown };
    const avatarUrl =
      data && typeof data === 'object' ? (data as { avatar_url?: unknown }).avatar_url : undefined;
    return {
      code: typeof code === 'string' ? code : undefined,
      avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : undefined,
    };
  } catch {
    return {};
  }
}

/** The sentence for a refused request: by `code`, then by status, else the fallback. */
function messageFor(status: number, code: string | undefined, fallback: string): string {
  if (code === 'file_type') return MESSAGES.fileType;
  if (code === 'file_too_large' || status === 413) return MESSAGES.fileTooLarge;
  if (code === 'unauthorized' || status === 401) return MESSAGES.signInAgain;
  return fallback;
}

export const useAvatarUpload = () => {
  const { user } = useAuth();
  const [state, setState] = useState<AvatarUploadState>({
    uploading: false,
    error: null,
    progress: 0,
  });

  const uploadAvatar = useCallback(async (file: File): Promise<string | null> => {
    if (!user) {
      setState(prev => ({ ...prev, error: MESSAGES.notAuthenticated }));
      return null;
    }

    if (!isAvatarMimeType(file.type)) {
      setState(prev => ({ ...prev, error: MESSAGES.fileType }));
      return null;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      setState(prev => ({ ...prev, error: MESSAGES.fileTooLarge }));
      return null;
    }

    setState(prev => ({ ...prev, uploading: true, error: null, progress: 0 }));

    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(AVATAR_ROUTE, { method: 'POST', body: form });
      setState(prev => ({ ...prev, progress: 50 }));

      const body = await readBody(response);
      if (response.ok && body.avatarUrl) {
        setState(prev => ({ ...prev, progress: 100, uploading: false }));
        return body.avatarUrl;
      }

      logger.warn({ status: response.status, code: body.code }, 'Avatar upload refused');
      const message = messageFor(response.status, body.code, MESSAGES.uploadFailed);
      setState(prev => ({ ...prev, error: message, uploading: false, progress: 0 }));
      return null;
    } catch (err) {
      logger.error({ err }, 'Avatar upload request failed');
      setState(prev => ({ ...prev, error: MESSAGES.uploadFailed, uploading: false, progress: 0 }));
      return null;
    }
  }, [user]);

  const deleteAvatar = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    setState(prev => ({ ...prev, uploading: true, error: null }));

    try {
      const response = await fetch(AVATAR_ROUTE, { method: 'DELETE' });
      if (response.ok) {
        setState(prev => ({ ...prev, uploading: false }));
        return true;
      }

      const body = await readBody(response);
      logger.warn({ status: response.status, code: body.code }, 'Avatar removal refused');
      const message = messageFor(response.status, body.code, MESSAGES.removeFailed);
      setState(prev => ({ ...prev, error: message, uploading: false }));
      return false;
    } catch (err) {
      logger.error({ err }, 'Avatar removal request failed');
      setState(prev => ({ ...prev, error: MESSAGES.removeFailed, uploading: false }));
      return false;
    }
  }, [user]);

  return {
    ...state,
    uploadAvatar,
    deleteAvatar,
  };
};
