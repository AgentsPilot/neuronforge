// lib/client/GoogleDrivePicker.tsx
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

// Declare the custom element types for TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'drive-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'app-id'?: string;
        'client-id'?: string;
        'oauth-token'?: string;
      }, HTMLElement>;
      'drive-picker-docs-view': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'include-folders'?: string;
        'mime-types'?: string;
        'select-folder-enabled'?: string;
        'mode'?: string;
      }, HTMLElement>;
    }
  }
}

// Google File metadata returned from picker
export interface GoogleFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  iconUrl?: string;
  lastEditedUtc?: number;
  sizeBytes?: number;
  description?: string;
  parentId?: string;
  serviceId?: string;
  type?: string;
  embedUrl?: string;
}

// Picker type options
export type PickerType = 'file' | 'sheet' | 'doc' | 'folder';

// MIME type mappings for different picker types
const MIME_TYPE_MAP: Record<PickerType, string | undefined> = {
  file: undefined, // All files
  sheet: 'application/vnd.google-apps.spreadsheet',
  doc: 'application/vnd.google-apps.document',
  folder: 'application/vnd.google-apps.folder',
};

interface GoogleDrivePickerProps {
  oauthToken: string;
  appId: string;
  pickerType?: PickerType;
  onFilesSelected: (files: GoogleFileMetadata[]) => void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  multiSelect?: boolean;
  // Custom MIME types (overrides pickerType)
  mimeTypes?: string;
}

export function GoogleDrivePicker({
  oauthToken,
  appId,
  pickerType = 'file',
  onFilesSelected,
  onCancel,
  onError,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  multiSelect = false, // Reserved for future use when web component supports it
  mimeTypes,
}: GoogleDrivePickerProps) {
  const pickerRef = useRef<HTMLElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Dynamically import the web component only on client side
  useEffect(() => {
    import('@googleworkspace/drive-picker-element').then(() => {
      setIsLoaded(true);
    });
  }, []);

  // Determine MIME types based on picker type or custom mimeTypes
  const effectiveMimeTypes = mimeTypes || MIME_TYPE_MAP[pickerType];
  const isFolder = pickerType === 'folder';

  // Handle picker:picked event
  const handlePicked = useCallback((event: Event) => {
    const customEvent = event as CustomEvent;
    const docs = customEvent.detail?.docs || [];

    console.log('Picker picked event:', docs);

    // Transform to our metadata format
    const files: GoogleFileMetadata[] = docs.map((doc: any) => ({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      url: doc.url,
      iconUrl: doc.iconUrl,
      lastEditedUtc: doc.lastEditedUtc,
      sizeBytes: doc.sizeBytes,
      description: doc.description,
      parentId: doc.parentId,
      serviceId: doc.serviceId,
      type: doc.type,
      embedUrl: doc.embedUrl,
    }));

    onFilesSelected(files);
  }, [onFilesSelected]);

  // Handle picker:cancel event
  const handleCancel = useCallback(() => {
    console.log('Picker cancelled');
    onCancel?.();
  }, [onCancel]);

  // Handle errors
  const handleError = useCallback((event: Event) => {
    const customEvent = event as CustomEvent;
    console.error('Picker error:', customEvent.detail);
    onError?.(new Error(customEvent.detail?.message || 'Picker error'));
  }, [onError]);

  // Set up event listeners - wait for both isLoaded and the ref to be available
  useEffect(() => {
    if (!isLoaded) return;

    const picker = pickerRef.current;
    if (!picker) return;

    picker.addEventListener('picker:picked', handlePicked);
    picker.addEventListener('picker:cancel', handleCancel);
    picker.addEventListener('picker:error', handleError);

    return () => {
      picker.removeEventListener('picker:picked', handlePicked);
      picker.removeEventListener('picker:cancel', handleCancel);
      picker.removeEventListener('picker:error', handleError);
    };
  }, [isLoaded, handlePicked, handleCancel, handleError]);

  // Don't render until web component is loaded
  if (!isLoaded) {
    return <div>Loading picker...</div>;
  }

  return (
    <drive-picker
      ref={pickerRef}
      app-id={appId}
      oauth-token={oauthToken}
    >
      <drive-picker-docs-view
        include-folders={isFolder ? 'true' : 'false'}
        select-folder-enabled={isFolder ? 'true' : 'false'}
        {...(effectiveMimeTypes && { 'mime-types': effectiveMimeTypes })}
        mode="list"
      />
    </drive-picker>
  );
}

// Button component that opens the picker
interface GoogleDrivePickerButtonProps extends Omit<GoogleDrivePickerProps, 'onFilesSelected'> {
  onFilesSelected: (files: GoogleFileMetadata[]) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function GoogleDrivePickerButton({
  oauthToken,
  appId,
  pickerType = 'file',
  onFilesSelected,
  onCancel,
  onError,
  multiSelect = false,
  mimeTypes,
  buttonText,
  buttonClassName,
  disabled = false,
}: GoogleDrivePickerButtonProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleFilesSelected = (files: GoogleFileMetadata[]) => {
    setShowPicker(false);
    onFilesSelected(files);
  };

  const handleCancel = () => {
    setShowPicker(false);
    onCancel?.();
  };

  // Default button text based on picker type
  const defaultButtonText = {
    file: 'Select from Google Drive',
    sheet: 'Select Google Sheet',
    doc: 'Select Google Doc',
    folder: 'Select Google Drive Folder',
  }[pickerType];

  return (
    <div>
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        disabled={disabled || !oauthToken}
        className={buttonClassName}
        style={!buttonClassName ? {
          padding: '12px 24px',
          backgroundColor: disabled || !oauthToken ? '#9ca3af' : '#4285f4',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: disabled || !oauthToken ? 'not-allowed' : 'pointer',
          fontSize: '16px',
          fontWeight: 500,
        } : undefined}
      >
        {buttonText || defaultButtonText}
      </button>

      {showPicker && oauthToken && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            // Close when clicking the backdrop
            if (e.target === e.currentTarget) {
              handleCancel();
            }
          }}
        >
          <div style={{ position: 'relative', backgroundColor: 'white', borderRadius: '8px', padding: '16px', minWidth: '400px', minHeight: '300px' }}>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666',
                padding: '4px 8px',
                lineHeight: 1,
              }}
              aria-label="Close picker"
            >
              ×
            </button>
            <GoogleDrivePicker
              oauthToken={oauthToken}
              appId={appId}
              pickerType={pickerType}
              onFilesSelected={handleFilesSelected}
              onCancel={handleCancel}
              onError={onError}
              multiSelect={multiSelect}
              mimeTypes={mimeTypes}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default GoogleDrivePicker;