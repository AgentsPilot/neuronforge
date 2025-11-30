# LinkedIn Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Professional
**Last Updated**: 2025-11-30

---

## Overview

Access LinkedIn profile, create posts, manage connections, and interact with your professional network. Use for professional networking, sharing content, retrieving profile information, posting updates, accessing organization data, and managing LinkedIn connections and posts.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow | LinkedIn OAuth 2.0 authorization code flow |
| Authorization Endpoint | https://www.linkedin.com/oauth/v2/authorization | LinkedIn authorization URL |
| Token Endpoint | https://www.linkedin.com/oauth/v2/accessToken | Token exchange and refresh endpoint |
| Scopes Reference | https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication | Available OAuth scopes for LinkedIn |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Profile API | https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api | Access user profile information |
| Posts API | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api | Create and manage posts |
| Organizations API | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations | Access company/organization data |
| UGC Post API | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api | User-generated content posts |

---

## High-Level Decisions

- **OAuth Flow**: Standard OAuth 2.0 with LinkedIn-specific scopes
- **Required Scopes**: openid, profile, email, w_member_social
- **Max Post Length**: 3000 characters per post
- **Max Posts Per Request**: 50 posts for personal, 100 for organizations
- **Partner Program**: Some endpoints (connections, organization search) require LinkedIn Partner Program approval

---

## Actions

### 1. get_profile
**Description**: Retrieve authenticated user's LinkedIn profile information

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/me` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| projection | string | No | Optional projection fields (e.g., 'id,firstName,lastName,profilePicture') |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| id | string | LinkedIn user ID |
| first_name | string | User's first name |
| last_name | string | User's last name |
| profile_picture | string | URL to profile picture |
| vanity_name | string | LinkedIn vanity/custom URL name |
| raw_data | object | Complete raw profile data from API |

---

### 2. get_user_info
**Description**: Get user information via OpenID Connect (email, name, picture, locale)

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/userinfo` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| (none) | - | - | No parameters required |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| sub | string | OpenID Connect subject identifier |
| name | string | Full name |
| given_name | string | First name |
| family_name | string | Last name |
| picture | string | Profile picture URL |
| email | string | Email address |
| email_verified | boolean | Whether email is verified |
| locale | string | User's locale/language |

---

### 3. create_post
**Description**: Create and publish a post on LinkedIn with text and optional media

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v2/ugcPosts` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| text | string | Yes | The text content of the post (max 3000 characters) |
| visibility | string | No | Post visibility: 'PUBLIC' or 'CONNECTIONS' (default: PUBLIC) |
| media_url | string | No | Optional URL to share as an article or link preview |
| media_title | string | No | Optional title for the shared media/article (max 200 chars) |
| media_description | string | No | Optional description for the shared media (max 500 chars) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| post_id | string | Unique post identifier |
| post_urn | string | LinkedIn URN for the post |
| text | string | Text content of the post |
| visibility | string | Post visibility (PUBLIC or CONNECTIONS) |
| created_at | string | Timestamp when post was created |
| has_media | boolean | Whether the post includes media |

---

### 4. get_posts
**Description**: Retrieve the authenticated user's published LinkedIn posts

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/ugcPosts` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| count | number | No | Number of posts to retrieve (1-50, default: 10) |
| sort_by | string | No | Sort order: 'LAST_MODIFIED' or 'CREATED' (default: LAST_MODIFIED) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| posts | array | List of user's posts |
| posts[].post_id | string | Unique post identifier |
| posts[].post_urn | string | LinkedIn URN for the post |
| posts[].text | string | Post text content |
| posts[].created_at | integer | Creation timestamp (Unix ms) |
| posts[].last_modified_at | integer | Last modified timestamp |
| posts[].visibility | string | Post visibility setting |
| post_count | integer | Number of posts returned |
| total_available | integer | Total posts available |

---

### 5. get_organization
**Description**: Get detailed information about a LinkedIn organization/company page

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/organizations/{organization_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| organization_id | string | Yes | The LinkedIn organization ID (numeric) or vanity name |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| organization_id | string | LinkedIn organization ID |
| organization_urn | string | LinkedIn URN for the organization |
| name | string | Organization name |
| vanity_name | string | LinkedIn vanity URL name |
| logo_url | string | URL to organization logo |
| website | string | Organization website URL |
| industry | array | List of industry classifications |
| employee_count | integer | Number of employees |
| description | string | Organization description |
| locations | array | List of office locations |

---

### 6. search_organizations
**Description**: Search for LinkedIn organizations by keywords, industry, or company size

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/organizationSearch` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| keywords | string | Yes | Search keywords (company name or related terms) |
| industry | string | No | Optional industry filter (LinkedIn industry ID) |
| company_size | string | No | Company size filter: A(1-10) to H(10001+) |
| max_results | number | No | Maximum results (1-50, default: 10) |

**Note**: This endpoint requires LinkedIn Partner Program approval and may be restricted.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| organizations | array | List of matching organizations |
| result_count | integer | Number of results returned |
| total_available | integer | Total matching organizations |
| search_query | string | The search keywords used |

---

### 7. get_organization_posts
**Description**: Retrieve posts published by a LinkedIn organization/company page

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/ugcPosts?q=authors&authors=urn:li:organization:{organization_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| organization_id | string | Yes | The LinkedIn organization ID (numeric) |
| count | number | No | Number of posts to retrieve (1-100, default: 10) |

**Note**: Requires admin access to the organization or appropriate permissions.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| organization_id | string | Organization ID that was queried |
| posts | array | List of organization posts |
| post_count | integer | Number of posts returned |
| total_available | integer | Total posts available |

---

### 8. get_connections
**Description**: Get the authenticated user's 1st-degree LinkedIn connections

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v2/connections` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| start | number | No | Pagination start offset (default: 0) |
| count | number | No | Connections per page (1-50, default: 50) |

**Note**: This endpoint requires LinkedIn Partner Program approval and may be restricted.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| connections | array | List of 1st-degree connections |
| connections[].person_urn | string | LinkedIn URN for the person |
| connections[].person_id | string | LinkedIn person ID |
| connection_count | integer | Number of connections returned |
| start | integer | Pagination offset used |
| total_available | integer | Total connections available |
| has_more | boolean | Whether more connections are available |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/linkedin-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/linkedin-plugin-executor.ts` | Executor class implementing all LinkedIn actions |

---

## Environment Variables

```bash
LINKEDIN_CLIENT_ID=your_linkedin_client_id_here
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret_here
```

To obtain credentials:
1. Go to https://www.linkedin.com/developers/apps
2. Create a new app
3. Add products: Sign In with LinkedIn, Share on LinkedIn
4. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/linkedin`
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 8 actions: get_profile, get_user_info, create_post, get_posts, get_organization, search_organizations, get_organization_posts, get_connections |
