/**
 * Contact Documents Repository
 * Handles all database operations for CRM contact documents
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'ContactDocumentsRepository' });

// Document types
export type DocumentType =
  | 'contract'
  | 'intake_form'
  | 'invoice'
  | 'receipt'
  | 'id_document'
  | 'medical'
  | 'insurance'
  | 'other';

export type DocumentStatus = 'active' | 'archived' | 'deleted';

// Type definitions
export interface ContactDocument {
  id: string;
  user_id: string;
  contact_id: string;
  name: string;
  document_type: DocumentType;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  storage_bucket: string;
  description: string | null;
  tags: string[];
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface ContactDocumentInsert {
  user_id: string;
  contact_id: string;
  name: string;
  document_type?: DocumentType;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  storage_bucket?: string;
  description?: string | null;
  tags?: string[];
}

export interface ContactDocumentUpdate {
  name?: string;
  document_type?: DocumentType;
  description?: string | null;
  tags?: string[];
  status?: DocumentStatus;
}

export interface ContactDocumentRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface ContactDocumentListOptions {
  document_type?: DocumentType;
  status?: DocumentStatus;
  limit?: number;
  offset?: number;
}

export class ContactDocumentsRepository {
  /**
   * Create a new document record
   */
  async create(
    document: ContactDocumentInsert
  ): Promise<ContactDocumentRepositoryResult<ContactDocument>> {
    try {
      logger.info(
        { userId: document.user_id, contactId: document.contact_id },
        'Creating contact document'
      );

      const { data, error } = await supabaseServer
        .from('contact_documents')
        .insert({
          user_id: document.user_id,
          contact_id: document.contact_id,
          name: document.name,
          document_type: document.document_type || 'other',
          file_name: document.file_name,
          file_size: document.file_size,
          mime_type: document.mime_type,
          storage_path: document.storage_path,
          storage_bucket: document.storage_bucket || 'contact-documents',
          description: document.description || null,
          tags: document.tags || []
        })
        .select()
        .single();

      if (error) {
        logger.error({ err: error, userId: document.user_id }, 'Failed to create contact document');
        throw error;
      }

      logger.info(
        { documentId: data.id, userId: document.user_id, contactId: document.contact_id },
        'Contact document created'
      );

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'ContactDocumentsRepository.create failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find document by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<ContactDocumentRepositoryResult<ContactDocument>> {
    try {
      const { data, error } = await supabaseServer
        .from('contact_documents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, documentId: id }, 'ContactDocumentsRepository.findById failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List documents for a contact
   */
  async listByContact(
    contactId: string,
    userId: string,
    options: ContactDocumentListOptions = {}
  ): Promise<ContactDocumentRepositoryResult<ContactDocument[]>> {
    try {
      const { document_type, status = 'active', limit = 50, offset = 0 } = options;

      let query = supabaseServer
        .from('contact_documents')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .eq('status', status)
        .order('created_at', { ascending: false });

      if (document_type) {
        query = query.eq('document_type', document_type);
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, contactId }, 'ContactDocumentsRepository.listByContact failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count documents for a contact
   */
  async countByContact(
    contactId: string,
    userId: string,
    options: { document_type?: DocumentType; status?: DocumentStatus } = {}
  ): Promise<ContactDocumentRepositoryResult<number>> {
    try {
      const { document_type, status = 'active' } = options;

      let query = supabaseServer
        .from('contact_documents')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .eq('status', status);

      if (document_type) {
        query = query.eq('document_type', document_type);
      }

      const { count, error } = await query;

      if (error) {
        throw error;
      }

      return { data: count || 0, error: null };
    } catch (error) {
      logger.error({ err: error, contactId }, 'ContactDocumentsRepository.countByContact failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a document
   */
  async update(
    id: string,
    userId: string,
    update: ContactDocumentUpdate
  ): Promise<ContactDocumentRepositoryResult<ContactDocument>> {
    try {
      logger.info({ documentId: id, userId }, 'Updating contact document');

      const { data, error } = await supabaseServer
        .from('contact_documents')
        .update({
          ...update,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info({ documentId: id }, 'Contact document updated');

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, documentId: id }, 'ContactDocumentsRepository.update failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Soft delete a document (sets status to 'deleted')
   */
  async delete(
    id: string,
    userId: string
  ): Promise<ContactDocumentRepositoryResult<boolean>> {
    try {
      logger.info({ documentId: id, userId }, 'Soft deleting contact document');

      const { error } = await supabaseServer
        .from('contact_documents')
        .update({
          status: 'deleted',
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        throw error;
      }

      logger.info({ documentId: id }, 'Contact document soft deleted');

      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, documentId: id }, 'ContactDocumentsRepository.delete failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get document by storage path (for checking duplicates)
   */
  async findByStoragePath(
    storagePath: string,
    userId: string
  ): Promise<ContactDocumentRepositoryResult<ContactDocument>> {
    try {
      const { data, error } = await supabaseServer
        .from('contact_documents')
        .select('*')
        .eq('storage_path', storagePath)
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, storagePath }, 'ContactDocumentsRepository.findByStoragePath failed');
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance
export const contactDocumentsRepository = new ContactDocumentsRepository();
