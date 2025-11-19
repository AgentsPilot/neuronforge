# Onboarding Data Storage

## Overview
All user onboarding data is now comprehensively stored in the `profiles` table in Supabase, with both individual columns for easy querying and a complete JSONB backup.

## Database Schema

### Individual Columns
The following columns store onboarding data for easy access and filtering:

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `company` | TEXT | User's company name | "Acme Corp" |
| `job_title` | TEXT | User's job title | "Product Manager" |
| `onboarding_goal` | TEXT | User's primary goal | "Automate email summaries" |
| `onboarding_mode` | TEXT | Preferred trigger mode | "on_demand", "scheduled", "monitor", "guided" |
| `domain` | TEXT | User's work domain | "sales", "marketing", "operations", etc. |
| `role` | TEXT | User's role context | "business_owner", "manager", "consultant", etc. |
| `timezone` | TEXT | User's timezone | "America/New_York" |
| `onboarding` | BOOLEAN | Completion flag | true/false |

### JSONB Backup Column
`onboarding_data` (JSONB) - Stores complete onboarding data as JSON:

```json
{
  "profile": {
    "fullName": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp",
    "jobTitle": "Product Manager",
    "timezone": "America/New_York"
  },
  "goal": "I want to get a summary of my last 10 emails every morning",
  "mode": "scheduled",
  "domain": "operations",
  "role": "manager",
  "completedAt": "2025-11-18T10:30:00.000Z"
}
```

## Benefits

### Individual Columns
- **Fast Queries**: Filter users by company, role, domain, etc.
- **Easy Joins**: Use in SQL joins with other tables
- **Database Indexes**: Efficient searching and sorting
- **Analytics**: Aggregate data by role, domain, company

### JSONB Column
- **Complete Backup**: Never lose any onboarding data
- **Future-Proof**: Easy to add new fields without schema changes
- **Audit Trail**: Includes completion timestamp
- **Flexibility**: Query nested data with Postgres JSONB operators

## Migration Required

Apply this migration to add the columns:
```bash
supabase/migrations/20251118_add_onboarding_fields_to_profiles.sql
```

## Usage Examples

### Query by Company
```sql
SELECT * FROM profiles WHERE company = 'Acme Corp';
```

### Query by Role
```sql
SELECT * FROM profiles WHERE role = 'business_owner';
```

### Query by Onboarding Mode
```sql
SELECT * FROM profiles WHERE onboarding_mode = 'scheduled';
```

### Query JSONB Data
```sql
-- Get all users who want email automation
SELECT * FROM profiles
WHERE onboarding_data->>'goal' LIKE '%email%';

-- Get completion timestamp
SELECT
  full_name,
  onboarding_data->>'completedAt' as completed_at
FROM profiles
WHERE onboarding = true;
```

### Analytics Queries
```sql
-- Count users by role
SELECT role, COUNT(*)
FROM profiles
GROUP BY role;

-- Count users by domain
SELECT domain, COUNT(*)
FROM profiles
GROUP BY domain;

-- Count users by mode preference
SELECT onboarding_mode, COUNT(*)
FROM profiles
GROUP BY onboarding_mode;
```

## Data Flow

1. **User completes onboarding** (4 steps)
2. **Data stored in React state** (in-memory during onboarding)
3. **On completion**: All data saved to `profiles` table
   - Individual columns populated
   - JSONB column populated
   - localStorage backup created
4. **Redirect to prompt ideas generator**

## Backward Compatibility

The code includes fallback logic:
- If new columns don't exist, saves minimal profile data
- Stores complete data in localStorage as backup
- Displays warning in console to run migration
- No errors or crashes if migration not applied

## Files Modified

1. `supabase/migrations/20251118_add_onboarding_fields_to_profiles.sql` - Database migration
2. `supabase/migrations/20251118_update_profiles_role_constraint.sql` - Role constraint update
3. `components/onboarding/hooks/useOnboarding.ts` - Updated save logic
4. This documentation file

## Testing

After applying the migration, test by:
1. Going through onboarding flow
2. Entering all fields (company, job title, goal, mode, role)
3. Checking browser console for success logs
4. Verifying data in Supabase dashboard:
   ```sql
   SELECT * FROM profiles WHERE id = 'your-user-id';
   ```
5. Checking individual columns are populated
6. Checking `onboarding_data` JSONB column contains complete data
