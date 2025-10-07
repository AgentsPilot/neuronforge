import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';

interface AvatarUploadState {
  uploading: boolean;
  error: string | null;
  progress: number;
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
      setState(prev => ({ ...prev, error: 'User not authenticated' }));
      return null;
    }

    // Validate file
    if (!file.type.startsWith('image/')) {
      setState(prev => ({ ...prev, error: 'Please select an image file' }));
      return null;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setState(prev => ({ ...prev, error: 'Image must be less than 5MB' }));
      return null;
    }

    setState(prev => ({ ...prev, uploading: true, error: null, progress: 0 }));

    try {
      // Create unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = fileName; // Just the filename, not nested in folder

      // Delete old avatar if it exists
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .single();

      if (profile?.avatar_url) {
        // Extract filename from URL and delete old file
        const oldFileName = profile.avatar_url.split('/').pop();
        if (oldFileName && oldFileName !== fileName) {
          await supabase.storage
            .from('avatars')
            .remove([oldFileName]);
        }
      }

      // Upload new avatar
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw uploadError;
      }

      setState(prev => ({ ...prev, progress: 50 }));

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const avatarUrl = urlData.publicUrl;

      // Update profile with new avatar URL
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (profileError) {
        throw profileError;
      }

      setState(prev => ({ ...prev, progress: 100, uploading: false }));

      return avatarUrl;

    } catch (error) {
      console.error('Avatar upload error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      let errorMessage = 'Failed to upload avatar';
      
      if (error && typeof error === 'object') {
        if ('message' in error) {
          errorMessage = error.message as string;
        } else if ('error' in error) {
          errorMessage = (error as any).error;
        } else if ('statusText' in error) {
          errorMessage = (error as any).statusText;
        }
      }
      
      setState(prev => ({ ...prev, error: errorMessage, uploading: false, progress: 0 }));
      return null;
    }
  }, [user]);

  const deleteAvatar = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    setState(prev => ({ ...prev, uploading: true, error: null }));

    try {
      // Get current avatar URL
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .single();

      if (profile?.avatar_url) {
        // Extract filename and delete from storage
        const fileName = profile.avatar_url.split('/').pop();
        if (fileName) {
          await supabase.storage
            .from('avatars')
            .remove([`avatars/${fileName}`]);
        }
      }

      // Update profile to remove avatar URL
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          avatar_url: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (profileError) {
        throw profileError;
      }

      setState(prev => ({ ...prev, uploading: false }));
      return true;

    } catch (error) {
      console.error('Avatar deletion error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete avatar';
      setState(prev => ({ ...prev, error: errorMessage, uploading: false }));
      return false;
    }
  }, [user]);

  return {
    ...state,
    uploadAvatar,
    deleteAvatar,
  };
};