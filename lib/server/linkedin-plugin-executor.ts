// lib/server/linkedin-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'linkedin';

export class LinkedInPluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = 'https://api.linkedin.com';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'get_profile':
        return await this.getProfile(connection, parameters);
      case 'get_user_info':
        return await this.getUserInfo(connection, parameters);
      case 'create_post':
        return await this.createPost(connection, parameters);
      case 'get_posts':
        return await this.getPosts(connection, parameters);
      case 'get_organization':
        return await this.getOrganization(connection, parameters);
      case 'search_organizations':
        return await this.searchOrganizations(connection, parameters);
      case 'get_organization_posts':
        return await this.getOrganizationPosts(connection, parameters);
      case 'get_connections':
        return await this.getConnections(connection, parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  // Action 1: Get Profile
  private async getProfile(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting LinkedIn profile');

    const { projection } = parameters;

    let url = `${this.apiBaseUrl}/v2/me`;

    if (projection) {
      url += `?projection=${encodeURIComponent(projection)}`;
    }

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_profile');

    return {
      id: data.id,
      first_name: data.firstName?.localized || data.localizedFirstName,
      last_name: data.lastName?.localized || data.localizedLastName,
      profile_picture: data.profilePicture?.displayImage || null,
      vanity_name: data.vanityName || null,
      raw_data: data
    };
  }

  // Action 2: Get User Info (OpenID Connect)
  private async getUserInfo(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting LinkedIn user info via OpenID Connect');

    const response = await fetch(`${this.apiBaseUrl}/v2/userinfo`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_user_info');

    return {
      sub: data.sub,
      name: data.name,
      given_name: data.given_name,
      family_name: data.family_name,
      picture: data.picture,
      email: data.email,
      email_verified: data.email_verified,
      locale: data.locale
    };
  }

  // Action 3: Create Post
  private async createPost(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Creating LinkedIn post');

    const { text, visibility = 'PUBLIC', media_url, media_title, media_description } = parameters;

    // First, get the user's person URN
    const profileResponse = await fetch(`${this.apiBaseUrl}/v2/userinfo`, {
      headers: this.buildAuthHeader(connection.access_token)
    });
    const profileData = await profileResponse.json();
    const personUrn = `urn:li:person:${profileData.sub}`;

    // Build the post request body
    const requestBody: any = {
      author: personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: text
          },
          shareMediaCategory: media_url ? 'ARTICLE' : 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': visibility
      }
    };

    // Add media if provided
    if (media_url) {
      requestBody.specificContent['com.linkedin.ugc.ShareContent'].media = [
        {
          status: 'READY',
          description: {
            text: media_description || ''
          },
          originalUrl: media_url,
          title: {
            text: media_title || ''
          }
        }
      ];
    }

    const response = await fetch(`${this.apiBaseUrl}/v2/ugcPosts`, {
      method: 'POST',
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'X-Restli-Protocol-Version': '2.0.0'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData }, 'create_post failed:');
      throw new Error(`LinkedIn create post failed: ${response.status} - ${errorData}`);
    }

    const postId = response.headers.get('x-restli-id');

    return {
      post_id: postId,
      post_urn: `urn:li:ugcPost:${postId}`,
      text: text,
      visibility: visibility,
      created_at: new Date().toISOString(),
      has_media: !!media_url
    };
  }

  // Action 4: Get Posts
  private async getPosts(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting LinkedIn posts');

    const { count = 10, sort_by = 'LAST_MODIFIED' } = parameters;

    // Get user's person URN
    const profileResponse = await fetch(`${this.apiBaseUrl}/v2/userinfo`, {
      headers: this.buildAuthHeader(connection.access_token)
    });
    const profileData = await profileResponse.json();
    const personUrn = `urn:li:person:${profileData.sub}`;
    const encodedUrn = encodeURIComponent(personUrn);

    const url = `${this.apiBaseUrl}/v2/ugcPosts?q=authors&authors=List(${encodedUrn})&count=${count}&sortBy=${sort_by}`;

    const response = await fetch(url, {
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    const data = await this.handleApiResponse(response, 'get_posts');

    const posts = (data.elements || []).map((post: any) => ({
      post_id: post.id,
      post_urn: `urn:li:ugcPost:${post.id}`,
      text: post.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '',
      created_at: post.created?.time,
      last_modified_at: post.lastModified?.time,
      visibility: post.visibility?.['com.linkedin.ugc.MemberNetworkVisibility'] || 'UNKNOWN'
    }));

    return {
      posts: posts,
      post_count: posts.length,
      total_available: data.paging?.total || posts.length
    };
  }

  // Action 6: Get Organization
  private async getOrganization(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting LinkedIn organization');

    const { organization_id } = parameters;

    const url = `${this.apiBaseUrl}/rest/organizations/${organization_id}`;

    const response = await fetch(url, {
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202501'
      }
    });

    const data = await this.handleApiResponse(response, 'get_organization');

    return {
      organization_id: data.id,
      organization_urn: `urn:li:organization:${data.id}`,
      name: data.localizedName || data.name,
      vanity_name: data.vanityName,
      logo_url: data.logoV2?.original || null,
      website: data.website?.localized || null,
      industry: data.industries || [],
      employee_count: data.staffCount || 0,
      description: data.description?.localized || null,
      locations: data.locations || []
    };
  }

  // Action 7: Search Organizations
  private async searchOrganizations(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Searching LinkedIn organizations');

    const { keywords, industry, company_size, max_results = 10 } = parameters;

    // Build search URL
    let url = `${this.apiBaseUrl}/v2/search?q=companiesV2&baseSearchParams.keywords=${encodeURIComponent(keywords)}`;

    if (industry) {
      url += `&companySearchParams.facetIndustry[0]=${encodeURIComponent(industry)}`;
    }

    if (company_size) {
      url += `&companySearchParams.facetCompanySize[0]=${company_size}`;
    }

    url += `&count=${max_results}`;

    const response = await fetch(url, {
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    // Handle restricted access
    if (response.status === 403) {
      throw new Error('Organization search requires LinkedIn Partner Program approval. Your application may not have access to this endpoint.');
    }

    const data = await this.handleApiResponse(response, 'search_organizations');

    const organizations = (data.elements || []).map((org: any) => ({
      organization_id: org.id,
      name: org.name,
      vanity_name: org.vanityName,
      logo_url: org.logo || null,
      industry: org.industry || null,
      employee_count: org.staffCount || 0
    }));

    return {
      organizations: organizations,
      result_count: organizations.length,
      total_available: data.paging?.total || organizations.length,
      search_query: keywords
    };
  }

  // Action 8: Get Organization Posts
  private async getOrganizationPosts(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting organization posts');

    const { organization_id, count = 10 } = parameters;

    const organizationUrn = `urn:li:organization:${organization_id}`;
    const encodedUrn = encodeURIComponent(organizationUrn);

    const url = `${this.apiBaseUrl}/v2/ugcPosts?q=authors&authors=List(${encodedUrn})&count=${count}`;

    const response = await fetch(url, {
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    const data = await this.handleApiResponse(response, 'get_organization_posts');

    const posts = (data.elements || []).map((post: any) => ({
      post_id: post.id,
      post_urn: `urn:li:ugcPost:${post.id}`,
      text: post.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '',
      created_at: post.created?.time,
      last_modified_at: post.lastModified?.time,
      author_urn: post.author
    }));

    return {
      organization_id: organization_id,
      posts: posts,
      post_count: posts.length,
      total_available: data.paging?.total || posts.length
    };
  }

  // Action 9: Get Connections
  private async getConnections(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting LinkedIn connections');

    const { start = 0, count = 50 } = parameters;

    const url = `${this.apiBaseUrl}/v2/connections?q=viewer&start=${start}&count=${count}`;

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    // Handle restricted access
    if (response.status === 403) {
      throw new Error('Connections API requires LinkedIn Partner Program approval. Your application may not have access to this endpoint.');
    }

    const data = await this.handleApiResponse(response, 'get_connections');

    const connections = (data.elements || []).map((conn: any) => ({
      person_urn: conn,
      person_id: conn.replace('urn:li:person:', '')
    }));

    return {
      connections: connections,
      connection_count: connections.length,
      start: start,
      total_available: data.paging?.total || connections.length,
      has_more: data.paging?.total > (start + count)
    };
  }

  // Override error mapping for LinkedIn-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // Partner Program required
    if (errorMsg.includes('Partner Program approval') || errorMsg.includes('requires Partner Program')) {
      return errorMsg;
    }

    // LinkedIn-specific error codes
    if (errorMsg.includes('403') && errorMsg.includes('insufficient')) {
      return commonErrors.insufficient_permissions || 'Insufficient permissions. You may need to reconnect with additional scopes or have Partner Program access.';
    }

    if (errorMsg.includes('duplicate')) {
      return commonErrors.duplicate_post || 'Duplicate content detected. LinkedIn prevents posting identical content within a short time period.';
    }

    if (errorMsg.includes('content policy') || errorMsg.includes('invalid_content')) {
      return commonErrors.invalid_content || 'Content violates LinkedIn policy or contains invalid characters.';
    }

    if (errorMsg.includes('admin') || errorMsg.includes('ADMINISTRATOR')) {
      return commonErrors.admin_access_required || 'Admin access to this organization is required.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Override connection test
  protected async performConnectionTest(connection: any): Promise<any> {
    const response = await fetch(`${this.apiBaseUrl}/v2/userinfo`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const user = await this.handleApiResponse(response, 'connection_test');

    return {
      user_id: user.sub,
      name: user.name,
      email: user.email,
      locale: user.locale
    };
  }
}
