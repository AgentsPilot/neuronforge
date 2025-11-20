// lib/services/StorageService.ts
// Service for managing user storage quotas and usage

import { SupabaseClient } from '@supabase/supabase-js';

export interface StorageQuota {
  quotaMB: number;
  usedMB: number;
  alertThreshold: number;
  percentageUsed: number;
  remainingMB: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
}

export interface StorageFile {
  id: string;
  filePath: string;
  fileSizeBytes: number;
  fileType: string | null;
  bucketName: string;
  uploadedAt: string;
  metadata: any;
}

export interface StoragePlan {
  id: string;
  planName: string;
  storagequotaMB: number;
  pricePerMonthUsd: number;
  description: string | null;
  isActive: boolean;
}

export interface TokenStorageTier {
  minTokens: number;
  storageMB: number;
  configKey: string;
}

export class StorageService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get storage quota based on total LLM tokens earned
   * @param totalLlmTokens Total LLM tokens earned (not pilot credits)
   * @returns Storage quota in MB
   */
  async getStorageQuotaForTokens(totalLlmTokens: number): Promise<number> {
    // Load all token-based tiers from config
    const { data: configs, error } = await this.supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .like('config_key', 'storage_tokens_%')
      .order('config_key', { ascending: true });

    if (error || !configs || configs.length === 0) {
      // Fallback default
      return 1000; // 1GB
    }

    // Parse tiers and find the appropriate one
    const tiers: TokenStorageTier[] = configs.map(c => ({
      minTokens: parseInt(c.config_key.replace('storage_tokens_', ''), 10),
      storageMB: parseInt(c.config_value, 10),
      configKey: c.config_key,
    })).sort((a, b) => b.minTokens - a.minTokens); // Sort descending

    // Find the highest tier that user qualifies for
    for (const tier of tiers) {
      if (totalLlmTokens >= tier.minTokens) {
        return tier.storageMB;
      }
    }

    // If no tier matches, use the lowest tier (0 tokens)
    return tiers[tiers.length - 1]?.storageMB || 1000;
  }

  /**
   * Calculate and apply storage quota based on user's monthly subscription tier
   */
  async applyStorageQuotaBasedOnTokens(userId: string): Promise<{ success: boolean; quotaMB: number }> {
    // Get user's monthly subscription credits (determines tier)
    const { data: subscription, error: subError } = await this.supabase
      .from('user_subscriptions')
      .select('monthly_credits')
      .eq('user_id', userId)
      .single();

    if (subError || !subscription) {
      throw new Error('User subscription not found');
    }

    // Convert monthly_credits (Pilot Credits) to LLM tokens for tier matching
    // monthly_credits is stored as Pilot Credits, need to convert to LLM tokens
    const monthlyPilotCredits = subscription.monthly_credits || 0;
    const monthlyLlmTokens = monthlyPilotCredits * 10; // Pilot Credits × 10 = LLM tokens

    // Get appropriate storage quota based on monthly subscription tier
    // Tier thresholds are in LLM tokens
    const quotaMB = await this.getStorageQuotaForTokens(monthlyLlmTokens);

    // Update user's storage quota
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({ storage_quota_mb: quotaMB })
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to apply storage quota:', error);
      throw new Error(`Failed to apply storage quota: ${error.message}`);
    }

    console.log(`✅ Applied ${quotaMB} MB storage to user ${userId} (monthly subscription: ${monthlyLlmTokens.toLocaleString()} LLM tokens)`);
    return { success: true, quotaMB };
  }

  /**
   * Get user's current storage quota and usage
   */
  async getStorageQuota(userId: string): Promise<StorageQuota> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('storage_quota_mb, storage_used_mb, storage_alert_threshold')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Return default quota if not found
      return {
        quotaMB: 1000, // 1GB default
        usedMB: 0,
        alertThreshold: 0.9,
        percentageUsed: 0,
        remainingMB: 1000,
        isNearLimit: false,
        isOverLimit: false,
      };
    }

    const quotaMB = data.storage_quota_mb || 1000;
    const usedMB = data.storage_used_mb || 0;
    const alertThreshold = data.storage_alert_threshold || 0.9;
    const percentageUsed = quotaMB > 0 ? usedMB / quotaMB : 0;
    const remainingMB = Math.max(0, quotaMB - usedMB);

    return {
      quotaMB,
      usedMB,
      alertThreshold,
      percentageUsed,
      remainingMB,
      isNearLimit: percentageUsed >= alertThreshold,
      isOverLimit: usedMB >= quotaMB,
    };
  }

  /**
   * Check if user has sufficient storage space
   */
  async checkStorageAvailable(
    userId: string,
    requiredMB: number
  ): Promise<{ available: boolean; quota: StorageQuota }> {
    const quota = await this.getStorageQuota(userId);
    return {
      available: quota.remainingMB >= requiredMB,
      quota,
    };
  }

  /**
   * Record a file upload
   */
  async recordFileUpload(
    userId: string,
    filePath: string,
    fileSizeBytes: number,
    bucketName: string,
    fileType?: string,
    metadata?: any
  ): Promise<{ success: boolean; quota: StorageQuota }> {
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

    // Check if user has enough storage
    const { available, quota } = await this.checkStorageAvailable(userId, fileSizeMB);

    if (!available) {
      throw new Error(
        `Insufficient storage. Required: ${fileSizeMB.toFixed(2)} MB, Available: ${quota.remainingMB.toFixed(2)} MB`
      );
    }

    // Record the upload
    const { error } = await this.supabase.from('storage_usage').insert({
      user_id: userId,
      file_path: filePath,
      file_size_bytes: fileSizeBytes,
      file_type: fileType,
      bucket_name: bucketName,
      metadata,
    });

    if (error) {
      console.error('Failed to record file upload:', error);
      throw new Error(`Failed to record file upload: ${error.message}`);
    }

    // Get updated quota
    const updatedQuota = await this.getStorageQuota(userId);

    console.log(`✅ Recorded upload: ${filePath} (${fileSizeMB.toFixed(2)} MB)`);

    return { success: true, quota: updatedQuota };
  }

  /**
   * Delete a file record
   */
  async deleteFileRecord(userId: string, filePath: string): Promise<{ success: boolean }> {
    const { error } = await this.supabase
      .from('storage_usage')
      .delete()
      .eq('user_id', userId)
      .eq('file_path', filePath);

    if (error) {
      console.error('Failed to delete file record:', error);
      throw new Error(`Failed to delete file record: ${error.message}`);
    }

    console.log(`✅ Deleted file record: ${filePath}`);
    return { success: true };
  }

  /**
   * Get user's uploaded files
   */
  async getUserFiles(userId: string, limit: number = 100): Promise<StorageFile[]> {
    const { data, error } = await this.supabase
      .from('storage_usage')
      .select('*')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch user files:', error);
      return [];
    }

    return (data || []).map((file) => ({
      id: file.id,
      filePath: file.file_path,
      fileSizeBytes: file.file_size_bytes,
      fileType: file.file_type,
      bucketName: file.bucket_name,
      uploadedAt: file.uploaded_at,
      metadata: file.metadata,
    }));
  }

  /**
   * Update user's storage quota (admin only)
   */
  async updateStorageQuota(
    userId: string,
    newQuotaMB: number,
    alertThreshold?: number
  ): Promise<{ success: boolean }> {
    const updateData: any = {
      storage_quota_mb: newQuotaMB,
    };

    if (alertThreshold !== undefined) {
      updateData.storage_alert_threshold = alertThreshold;
    }

    const { error } = await this.supabase
      .from('user_subscriptions')
      .update(updateData)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to update storage quota:', error);
      throw new Error(`Failed to update storage quota: ${error.message}`);
    }

    console.log(`✅ Updated storage quota for user ${userId}: ${newQuotaMB} MB`);
    return { success: true };
  }

  /**
   * Get all available storage plans
   */
  async getStoragePlans(): Promise<StoragePlan[]> {
    const { data, error } = await this.supabase
      .from('storage_plans')
      .select('*')
      .eq('is_active', true)
      .order('storage_quota_mb', { ascending: true });

    if (error) {
      console.error('Failed to fetch storage plans:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get storage statistics for admin dashboard
   */
  async getStorageStats(): Promise<{
    totalUsers: number;
    totalStorageUsedMB: number;
    totalStorageQuotaMB: number;
    averageUsagePercent: number;
  }> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('storage_quota_mb, storage_used_mb');

    if (error || !data) {
      return {
        totalUsers: 0,
        totalStorageUsedMB: 0,
        totalStorageQuotaMB: 0,
        averageUsagePercent: 0,
      };
    }

    const totalUsers = data.length;
    const totalStorageUsedMB = data.reduce((sum, user) => sum + (user.storage_used_mb || 0), 0);
    const totalStorageQuotaMB = data.reduce((sum, user) => sum + (user.storage_quota_mb || 0), 0);
    const averageUsagePercent =
      totalStorageQuotaMB > 0 ? (totalStorageUsedMB / totalStorageQuotaMB) * 100 : 0;

    return {
      totalUsers,
      totalStorageUsedMB,
      totalStorageQuotaMB,
      averageUsagePercent,
    };
  }
}
