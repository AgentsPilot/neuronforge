'use client';

/**
 * MediaUploader Component
 * Reusable drag-and-drop image upload component for website blocks
 * Uploads to Supabase Storage bucket: website-images
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Loader2, ImageIcon, AlertCircle, Check } from 'lucide-react';

interface MediaUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
  bucket?: string;
  folder?: string;
  accept?: string;
  maxSizeMB?: number;
  className?: string;
  placeholder?: string;
  previewClassName?: string;
  showUrlInput?: boolean;
  disabled?: boolean;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export function MediaUploader({
  value,
  onChange,
  onRemove,
  bucket = 'website-images',
  folder = '',
  accept = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml',
  maxSizeMB = 5,
  className = '',
  placeholder,
  previewClassName = 'w-full h-32',
  showUrlInput = true,
  disabled = false
}: MediaUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [imageLoadError, setImageLoadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  // Reset image load error when value changes
  useEffect(() => {
    setImageLoadError(false);
  }, [value]);

  // Check if value is a valid URL (not a placeholder or relative path)
  const isValidImageUrl = value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:'));

  const handleFileSelect = useCallback(async (file: File) => {
    // Validate file type
    const validTypes = accept.split(',').map(t => t.trim());
    if (!validTypes.some(type => file.type === type || type === '*/*')) {
      setError('Invalid file type. Please upload an image.');
      return;
    }

    // Validate file size
    if (file.size > maxSizeBytes) {
      setError(`File too large. Maximum size is ${maxSizeMB}MB.`);
      return;
    }

    setStatus('uploading');
    setError(null);

    try {
      // Use server-side upload API to bypass RLS issues
      const formData = new FormData();
      formData.append('file', file);
      if (folder) {
        formData.append('folder', folder);
      }
      formData.append('bucket', bucket);

      const response = await fetch('/api/website/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      if (result.url) {
        onChange(result.url);
        setStatus('success');

        // Reset success status after 2 seconds
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        throw new Error('Failed to get public URL');
      }
    } catch (err) {
      console.error('File upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStatus('error');
    }
  }, [accept, bucket, folder, maxSizeBytes, maxSizeMB, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [disabled, handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleUrlSubmit = useCallback(() => {
    if (urlInput.trim()) {
      onChange(urlInput.trim());
      setUrlInput('');
    }
  }, [urlInput, onChange]);

  const handleRemove = useCallback(() => {
    if (onRemove) {
      onRemove();
    } else {
      onChange('');
    }
  }, [onChange, onRemove]);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Preview / Drop Zone */}
      <div
        className={`
          relative rounded-lg border-2 border-dashed transition-all overflow-hidden
          ${isDragging ? 'border-[#4F6EF7] bg-[#4F6EF7]/5' : 'border-[var(--v2-border)]'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[#4F6EF7]/50'}
          ${previewClassName}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        {isValidImageUrl && !imageLoadError ? (
          // Image Preview
          <>
            <img
              src={value}
              alt="Uploaded"
              className="w-full h-full object-cover"
              onError={() => setImageLoadError(true)}
            />
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          // Upload Placeholder
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--v2-text-muted)]">
            {status === 'uploading' ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-[#4F6EF7]" />
                <span className="text-sm">Uploading...</span>
              </>
            ) : status === 'success' ? (
              <>
                <Check className="w-8 h-8 text-green-500" />
                <span className="text-sm text-green-500">Uploaded!</span>
              </>
            ) : (
              <>
                {isDragging ? (
                  <Upload className="w-8 h-8 text-[#4F6EF7]" />
                ) : (
                  <ImageIcon className="w-8 h-8" />
                )}
                <span className="text-sm text-center px-4">
                  {placeholder || 'Drag & drop or click to upload'}
                </span>
                <span className="text-xs">Max {maxSizeMB}MB</span>
              </>
            )}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* URL Input (optional) - show when no valid image */}
      {showUrlInput && (!isValidImageUrl || imageLoadError) && (
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Or paste image URL..."
            className="flex-1 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleUrlSubmit();
              }
            }}
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={!urlInput.trim() || disabled}
            className="px-3 py-2 bg-[#4F6EF7] text-white rounded-lg hover:bg-[#3B5AE5] disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {/* Current URL Display - only show for valid URLs */}
      {isValidImageUrl && !imageLoadError && showUrlInput && (
        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)] truncate">
          <span className="truncate">{value}</span>
        </div>
      )}
    </div>
  );
}

export default MediaUploader;
