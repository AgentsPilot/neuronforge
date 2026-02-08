# HardcodeDetector V2 - Heuristic Testing

## Detection Rules

### Rule 1: Filter/Condition Values (Always Detect)
**Pattern**: `.filter`, `.condition`, `.where` paths ending with `.value`

✅ **Will Detect**:
- `step8.config.condition.conditions[0].value = "complaint"`
- `step8.config.condition.conditions[1].value = "refund"`
- `step8.filter.conditions[0].value = "urgent"`

### Rule 2: Params Values (Detect with Filters)
**Pattern**: `.params.*` but filtered by value characteristics

#### ✅ Will Detect (User Data)
- `step1.params.query = "in:inbox newer_than:7d"` (mixed case, special chars)
- `step1.params.folder = "inbox"` (lowercase)
- `step1.params.max_results = 10` (number)
- `step2.params.spreadsheet_id = "1pM8Wb..."` (long ID)
- `step2.params.range = "UrgentEmails"` (mixed case)
- `step10.params.range = "UrgentEmails"` (same - reused)

#### ✗ Won't Detect (Technical Enums/Config)
- `step1.params.content_level = "snippet"` (ends with `_level`)
- `step1.params.include_attachments = false` (boolean)
- `step2.params.major_dimension = "ROWS"` (ALL_CAPS enum)
- `step2.params.include_formula_values = false` (boolean + starts with `include_`)
- `step10.params.input_option = "USER_ENTERED"` (ends with `_option` + ALL_CAPS)
- `step10.params.insert_data_option = "INSERT_ROWS"` (ends with `_option` + ALL_CAPS)

## Heuristic Filters

### Filter 1: Boolean Skip
```typescript
if (typeof value === 'boolean') return false
```
**Rationale**: Booleans are always technical switches, never user data

### Filter 2: ALL_CAPS Enum Skip
```typescript
if (typeof value === 'string' &&
    value.length < 30 &&
    value === value.toUpperCase() &&
    !value.includes(' ') &&
    !/[^A-Z_]/.test(value)) {
  return false
}
```
**Rationale**:
- `ROWS`, `COLUMNS`, `USER_ENTERED`, `RAW`, `INSERT_ROWS` = API enums
- User data is rarely pure uppercase without spaces
- Exception: Has spaces or special chars = probably user text

**Examples**:
- ✗ `"ROWS"` - Skip
- ✗ `"USER_ENTERED"` - Skip
- ✓ `"URGENT COMPLAINT"` - Detect (has space)
- ✓ `"ABC123def"` - Detect (mixed case)

### Filter 3: Technical Param Name Patterns Skip
```typescript
if (paramName.startsWith('include_') ||
    paramName.startsWith('add_') ||
    paramName.endsWith('_option') ||
    paramName.endsWith('_dimension') ||
    paramName.endsWith('_level') ||
    paramName.endsWith('_attachments') ||
    paramName.endsWith('_values') ||
    paramName.endsWith('_existing')) {
  return false
}
```
**Rationale**: These naming patterns are consistent across plugins for technical settings

**Examples**:
- ✗ `include_formula_values` - Skip
- ✗ `include_attachments` - Skip
- ✗ `add_headers` - Skip
- ✗ `input_option` - Skip
- ✗ `major_dimension` - Skip
- ✗ `content_level` - Skip
- ✗ `overwrite_existing` - Skip
- ✓ `spreadsheet_id` - Detect (doesn't match pattern)
- ✓ `range` - Detect (doesn't match pattern)

## Expected Results for Real Agent

### Input: Gmail Complaint Agent
```json
[
  { "id": "step1", "params": {
    "query": "in:inbox newer_than:7d",
    "folder": "inbox",
    "max_results": 10,
    "content_level": "snippet",
    "include_attachments": false
  }},
  { "id": "step2", "params": {
    "spreadsheet_id": "1pM8Wb...",
    "range": "UrgentEmails",
    "major_dimension": "ROWS",
    "include_formula_values": false
  }},
  { "id": "step8", "config": {
    "condition": {
      "conditions": [
        { "value": "complaint" },
        { "value": "refund" },
        { "value": "angry" },
        { "value": "not working" }
      ]
    }
  }},
  { "id": "step10", "params": {
    "spreadsheet_id": "1pM8Wb...",
    "range": "UrgentEmails",
    "input_option": "USER_ENTERED",
    "insert_data_option": "INSERT_ROWS"
  }}
]
```

### Expected Detection Output

**✅ WILL DETECT (10 values)**:
1. `step1.params.query = "in:inbox newer_than:7d"` - User query
2. `step1.params.folder = "inbox"` - User folder
3. `step1.params.max_results = 10` - User limit
4. `step2.params.spreadsheet_id = "1pM8Wb..."` - **Critical** (used 2x)
5. `step2.params.range = "UrgentEmails"` - User range
6. `step8.config.condition.conditions[0].value = "complaint"` - Business logic
7. `step8.config.condition.conditions[1].value = "refund"` - Business logic
8. `step8.config.condition.conditions[2].value = "angry"` - Business logic
9. `step8.config.condition.conditions[3].value = "not working"` - Business logic
10. `step10.params.range = "UrgentEmails"` - User range (reused)

**✗ WON'T DETECT (6 values)**:
1. `step1.params.content_level = "snippet"` - Ends with `_level`
2. `step1.params.include_attachments = false` - Boolean
3. `step2.params.major_dimension = "ROWS"` - ALL_CAPS enum
4. `step2.params.include_formula_values = false` - Boolean + `include_` prefix
5. `step10.params.input_option = "USER_ENTERED"` - Ends with `_option` + ALL_CAPS
6. `step10.params.insert_data_option = "INSERT_ROWS"` - Ends with `_option` + ALL_CAPS

## Categorization

**Resource IDs** (Critical Priority):
- `spreadsheet_id = "1pM8Wb..."` (15+ chars, reused in 2 steps)

**Configuration** (Medium Priority):
- `query = "in:inbox newer_than:7d"`
- `folder = "inbox"`
- `max_results = 10`
- `range = "UrgentEmails"` (reused)

**Business Logic** (Medium Priority):
- Filter values: `"complaint"`, `"refund"`, `"angry"`, `"not working"`

## Success Criteria

✅ Detects ALL user-facing data values
✅ Skips ALL technical enum configurations
✅ No hardcoded lists - only heuristics
✅ Scales to any plugin automatically
✅ Distinguishes user data from API settings

## Edge Cases Handled

1. **Mixed case with underscores**: `"USER_ENTERED"` → Skip (ALL_CAPS)
2. **Lowercase with underscores**: `"some_value"` → Detect (not ALL_CAPS)
3. **Short all caps**: `"OK"` → Skip (ALL_CAPS enum)
4. **Long user text in caps**: `"URGENT COMPLAINT NEEDS ATTENTION"` → Detect (has spaces)
5. **Numbers**: `10`, `5`, `100` → Detect (numbers are user limits/thresholds)
6. **Long IDs**: `"1pM8WbXt..."` → Detect (15+ chars = resource ID)
7. **Boolean flags**: `true`, `false` → Skip (always technical)
8. **Technical suffixes**: `*_option`, `*_level`, `*_dimension` → Skip
9. **Technical prefixes**: `include_*`, `add_*` → Skip
