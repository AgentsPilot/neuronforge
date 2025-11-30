// lib/server/google-base-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';

/**
 * Base class for all Google service plugin executors
 * Provides common Google-specific error mapping and utilities
 * for Google APIs (Gmail, Drive, Sheets, Docs, Calendar, etc.)
 */
export abstract class GoogleBasePluginExecutor extends BasePluginExecutor {
  protected googleApisUrl: string;

  constructor(pluginName: string, userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);

    this.googleApisUrl = 'https://www.googleapis.com';
  }

  

  /**
   * Map Google-specific errors to user-friendly messages
   * This provides common Google error handling, while allowing subclasses
   * to add service-specific error mapping
   */
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Check for Google OAuth/auth errors
    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      return commonErrors.auth_failed || 'Authentication failed. Please reconnect this Google service.';
    }

    // Check for quota/rate limit errors (common across all Google services)
    if (error.message?.includes('quota') || error.message?.includes('quotaExceeded')) {
      return commonErrors.quota_exceeded || commonErrors.api_rate_limit || 'Google API quota exceeded. Please try again later.';
    }

    if (error.message?.includes('429') || error.message?.includes('rateLimitExceeded')) {
      return commonErrors.api_rate_limit || 'Rate limit exceeded. Please wait a moment and try again.';
    }

    // Check for permission errors
    if (error.message?.includes('403') || error.message?.includes('forbidden')) {
      return commonErrors.permission_denied || 'Permission denied. Please check your Google account permissions.';
    }

    // Check for not found errors
    if (error.message?.includes('404') || error.message?.includes('notFound')) {
      return commonErrors.not_found || 'Resource not found.';
    }

    // Check for invalid request errors
    if (error.message?.includes('400') || error.message?.includes('invalid')) {
      return commonErrors.invalid_request || 'Invalid request parameters.';
    }

    // Allow subclasses to handle service-specific errors
    return this.mapGoogleServiceSpecificError(error, commonErrors);
  }

  /**
   * Hook for subclasses to add service-specific error handling
   * (e.g., Gmail daily limit, Drive file size limit, etc.)
   * @param error - The error object
   * @param commonErrors - Common error messages from plugin definition
   * @returns User-friendly error message or null to use default handling
   */
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Default: no service-specific handling
    // Subclasses can override this method
    return null;
  }

  /**
   * Clean up a test resource (document, spreadsheet, etc.) via Drive API
   * Common pattern used in connection tests across Google services
   * @param accessToken - OAuth access token
   * @param resourceId - The ID of the resource to delete
   */
  protected async cleanupTestResource(accessToken: string, resourceId: string): Promise<void> {
    try {
      await fetch(`${this.googleApisUrl}/drive/v3/files/${resourceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      this.logger.debug({ resourceId }, 'Cleaned up test resource');
    } catch (cleanupError) {
      this.logger.warn({ err: cleanupError, resourceId }, 'Could not clean up test resource');
      // Don't throw - cleanup failure shouldn't fail the operation
    }
  }
}