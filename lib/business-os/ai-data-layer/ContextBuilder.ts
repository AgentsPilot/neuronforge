/**
 * ContextBuilder for AI Data Layer
 *
 * Builds rich context for LLM including user profile, stats, recent activity,
 * and entity lists for intelligent resolution.
 */

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import {
  schedulingServiceRepository,
  schedulingBookingRepository
} from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import type { UserContext } from './types';

const logger = createLogger({ service: 'AIDataLayerContextBuilder' });

export class ContextBuilder {
  /**
   * Build full context for LLM
   * This provides the LLM with everything it needs to understand the user's data
   */
  async buildContext(userId: string): Promise<UserContext> {
    logger.info({ userId }, 'Building AI data layer context');

    // Fetch all context in parallel for performance
    const [
      profileResult,
      contactsResult,
      servicesResult,
      statsResult,
      recentActivityResult
    ] = await Promise.all([
      this.fetchProfile(userId),
      this.fetchEntityLists(userId),
      this.fetchServices(userId),
      this.fetchStats(userId),
      this.fetchRecentActivity(userId)
    ]);

    const context: UserContext = {
      userId,
      profile: profileResult,
      stats: statsResult,
      recentActivity: recentActivityResult,
      entities: {
        services: servicesResult,
        contacts: contactsResult
      }
    };

    logger.info(
      {
        userId,
        contactCount: context.entities.contacts.length,
        serviceCount: context.entities.services.length,
        stats: context.stats
      },
      'AI data layer context built'
    );

    return context;
  }

  /**
   * Build minimal context (for simple queries)
   */
  async buildMinimalContext(userId: string): Promise<Pick<UserContext, 'userId' | 'profile'>> {
    const profile = await this.fetchProfile(userId);
    return { userId, profile };
  }

  private async fetchProfile(userId: string): Promise<UserContext['profile']> {
    try {
      const result = await businessProfileRepository.findByUserId(userId);
      if (result.data) {
        return {
          businessName: result.data.company_name || undefined,
          vertical: result.data.vertical || undefined,
          timezone: result.data.timezone || undefined,
          currency: result.data.currency || 'ILS',
          language: result.data.language || 'en'
        };
      }
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch profile for context');
    }

    return {
      currency: 'ILS',
      language: 'en'
    };
  }

  private async fetchEntityLists(
    userId: string
  ): Promise<Array<{ id: string; name: string; email?: string }>> {
    try {
      const result = await crmContactRepository.list(userId, {
        limit: 100,
        orderBy: 'updated_at',
        orderDirection: 'desc'
      });

      if (result.data) {
        return result.data.map(contact => ({
          id: contact.id,
          name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.email || 'Unknown',
          email: contact.email || undefined
        }));
      }
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch contacts for context');
    }

    return [];
  }

  private async fetchServices(
    userId: string
  ): Promise<Array<{ id: string; name: string; price: number; duration_minutes: number }>> {
    try {
      const result = await schedulingServiceRepository.listAll(userId, true);

      if (result.data) {
        return result.data.map(service => ({
          id: service.id,
          name: service.service_name,
          price: service.price || 0,
          duration_minutes: service.duration_minutes
        }));
      }
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch services for context');
    }

    return [];
  }

  private async fetchStats(userId: string): Promise<UserContext['stats']> {
    const defaultStats: UserContext['stats'] = {
      totalContacts: 0,
      todayBookings: 0,
      pendingTasks: 0,
      pendingInvoices: 0,
      thisWeekRevenue: 0
    };

    try {
      // Run all stat queries in parallel
      const [
        contactCountResult,
        todayBookingsResult,
        pendingTasksResult,
        pendingInvoicesResult
      ] = await Promise.all([
        crmContactRepository.count(userId),
        this.countTodayBookings(userId),
        this.countPendingTasks(userId),
        this.countPendingInvoices(userId)
      ]);

      return {
        totalContacts: contactCountResult.data || 0,
        todayBookings: todayBookingsResult,
        pendingTasks: pendingTasksResult,
        pendingInvoices: pendingInvoicesResult,
        thisWeekRevenue: 0 // TODO: Implement when needed
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch stats for context');
      return defaultStats;
    }
  }

  private async countTodayBookings(userId: string): Promise<number> {
    try {
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

      const result = await schedulingBookingRepository.list(userId, {
        startDate: startOfDay,
        endDate: endOfDay,
        status: 'confirmed'
      });

      return result.data?.length || 0;
    } catch {
      return 0;
    }
  }

  private async countPendingTasks(userId: string): Promise<number> {
    try {
      const result = await crmTaskRepository.countByStatus(userId);
      if (result.data) {
        return result.data.pending + result.data.in_progress;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async countPendingInvoices(userId: string): Promise<number> {
    try {
      const result = await paymentInvoiceRepository.list(userId, { status: 'sent' });
      return result.data?.length || 0;
    } catch {
      return 0;
    }
  }

  private async fetchRecentActivity(userId: string): Promise<UserContext['recentActivity']> {
    const activity: UserContext['recentActivity'] = {};

    try {
      // Get latest contact
      const contactsResult = await crmContactRepository.list(userId, {
        limit: 1,
        orderBy: 'created_at',
        orderDirection: 'desc'
      });

      if (contactsResult.data?.[0]) {
        const contact = contactsResult.data[0];
        activity.lastContact = {
          id: contact.id,
          name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown',
          createdAt: contact.created_at
        };
      }

      // Get latest booking
      const bookingsResult = await schedulingBookingRepository.list(userId, {
        limit: 1
      });

      if (bookingsResult.data?.[0]) {
        const booking = bookingsResult.data[0];
        activity.lastBooking = {
          id: booking.id,
          serviceName: (booking as any).service?.service_name || 'Service',
          date: booking.start_time
        };
      }

      // Get latest task
      const tasksResult = await crmTaskRepository.list(userId, {
        limit: 1,
        include_completed: true
      });

      if (tasksResult.data?.[0]) {
        const task = tasksResult.data[0];
        activity.lastTask = {
          id: task.id,
          title: task.title,
          status: task.status
        };
      }
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch recent activity for context');
    }

    return activity;
  }
}

// Singleton export
export const contextBuilder = new ContextBuilder();
