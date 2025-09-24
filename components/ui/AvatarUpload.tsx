import React, { useRef, useState } from 'react';
import { Camera, Upload, Trash2, Loader2, User, AlertCircle } from 'lucide-react';
import { useAvatarUpload } from '../onboarding/hooks/useAvatarUpload';

interface AvatarUploadProps {
  currentAvatarUrl?: string | null;
  userName?: string;
  userEmail?: string;
  size?: 'sm' | 'md' | 'lg';
  onAvatarChange?: (newAvatarUrl: string | null) => void;
  className?: string;
}

const AvatarUpload: React.FC<AvatarUploadProps> = ({
  currentAvatarUrl,
  userName,
  userEmail,
  size = 'lg',
  onAvatarChange,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { uploading, error, progress, uploadAvatar, deleteAvatar } = useAvatarUpload();

  // Size configurations
  const sizeConfig = {
    sm: { container: 'w-12 h-12', text: 'text-lg', button: 'w-6 h-6', icon: 'w-3 h-3' },
    md: { container: 'w-16 h-16', text: 'text-xl', button: 'w-8 h-8', icon: 'w-4 h-4' },
    lg: { container: 'w-24 h-24', text: 'text-3xl', button: 'w-10 h-10', icon: 'w-5 h-5' },
  };

  const config = sizeConfig[size];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload file
    uploadAvatar(file).then((avatarUrl) => {
      if (avatarUrl) {
        onAvatarChange?.(avatarUrl);
        setPreviewUrl(null);
      } else {
        setPreviewUrl(null);
      }
    });

    // Reset input
    event.target.value = '';
    setShowMenu(false);
  };

  const handleDeleteAvatar = async () => {
    const success = await deleteAvatar();
    if (success) {
      onAvatarChange?.(null);
    }
    setShowMenu(false);
  };

  const getInitials = () => {
    if (userName) {
      return userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (userEmail) {
      return userEmail.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const displayUrl = previewUrl || currentAvatarUrl;

  return (
    <div className={`relative group ${className}`}>
      {/* Avatar Display */}
      <div className={`${config.container} relative rounded-3xl overflow-hidden shadow-xl`}>
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Avatar"
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to initials if image fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
            <span className={config.text}>{getInitials()}</span>
          </div>
        )}

        {/* Upload Progress Overlay */}
        {uploading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="text-center text-white">
              {progress > 0 && (
                <div className="mb-2">
                  <div className="w-12 h-1 bg-gray-300 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              <Loader2 className="w-6 h-6 animate-spin mx-auto" />
              <div className="text-xs mt-1">Uploading...</div>
            </div>
          </div>
        )}
      </div>

      {/* Camera Button */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={uploading}
        className={`absolute bottom-0 right-0 ${config.button} bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 shadow-lg transition-all duration-300 group-hover:scale-110 disabled:opacity-50 disabled:scale-100 flex items-center justify-center`}
      >
        <Camera className={config.icon} />
      </button>

      {/* Action Menu */}
      {showMenu && !uploading && (
        <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50 min-w-[160px]">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload Photo
          </button>
          
          {currentAvatarUrl && (
            <button
              onClick={handleDeleteAvatar}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Remove Photo
            </button>
          )}
        </div>
      )}

      {/* Backdrop to close menu */}
      {showMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowMenu(false)}
        />
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Error Message */}
      {error && (
        <div className="absolute top-full left-0 mt-2 p-2 bg-red-50 text-red-600 text-xs rounded-lg border border-red-200 flex items-center gap-1 whitespace-nowrap">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
};

export default AvatarUpload;