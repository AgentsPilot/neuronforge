# Converting Enhanced Prompts for V6 HTML Test Page

## Your Current Enhanced Prompt Structure

Your current enhanced prompt has this structure (from previous phases):

```json
{
  "enhanced_prompt": {
    "sections": {
      "data": [...],
      "output": [...],
      "actions": [...],
      "delivery": [...],
      "processing_steps": [...]
    },
    "specifics": {...},
    "plan_title": "...",
    "plan_description": "..."
  }
}
```

## V6 Expected Structure

The V6 HTML test page expects a simpler structure:

```json
{
  "sections": {
    "data": [...],
    "actions": [...],
    "output": [...],
    "delivery": [...]
  }
}
```

## How to Convert

### Option 1: Use the HTML Test Page Directly

For your specific example, just fill in the HTML form with:

**Data Sources:**
```
Read from Google Sheet "MyLeads" tab "Leads"
```

**Actions:**
```
Filter rows where stage = 4
Group by Sales Person column
```

**Output Format:**
```
Format as HTML table with columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person
```

**Delivery:**
```
Email each salesperson their leads
CC meiribarak@gmail.com on all emails
If zero leads, email meiribarak@gmail.com stating "0 high qualified leads found"
```

### Option 2: Use curl to POST Directly

If you want to use your existing enhanced prompt structure, extract just the sections:

```bash
curl -X POST http://localhost:3000/api/v6/generate-workflow-plan \
  -H "Content-Type: application/json" \
  -d '{
    "enhancedPrompt": {
      "sections": {
        "data": [
          "Read from Google Sheet MyLeads tab Leads"
        ],
        "actions": [
          "Filter rows where stage = 4",
          "Group by Sales Person column"
        ],
        "output": [
          "Format as HTML table with columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person"
        ],
        "delivery": [
          "Email each salesperson their leads",
          "CC meiribarak@gmail.com on all emails",
          "If zero leads, email meiribarak@gmail.com"
        ]
      }
    },
    "modelProvider": "openai"
  }'
```

### Option 3: Create a Conversion Script

Create this file to convert your enhanced prompts:

**File: `scripts/convert-enhanced-prompt.js`**

```javascript
// Read your enhanced prompt
const yourEnhancedPrompt = {
  "enhanced_prompt": {
    "sections": {
      "data": [
        "- Read lead rows from the Google Sheet named \"MyLeads\".",
        "- Use the tab named \"Leads\" as the source of truth for lead rows.",
        // ... more data lines
      ],
      "output": [/* ... */],
      "actions": [/* ... */],
      "delivery": [/* ... */],
      "processing_steps": [/* ... */]
    },
    "specifics": {/* ... */}
  }
};

// Convert to V6 format
function convertToV6(oldFormat) {
  // Clean bullet points and extra text
  const cleanArray = (arr) => arr.map(s => s.replace(/^- /, '').trim());

  return {
    sections: {
      data: cleanArray(oldFormat.enhanced_prompt.sections.data),
      actions: cleanArray(oldFormat.enhanced_prompt.sections.actions),
      output: cleanArray(oldFormat.enhanced_prompt.sections.output),
      delivery: cleanArray(oldFormat.enhanced_prompt.sections.delivery)
    }
  };
}

const v6Format = convertToV6(yourEnhancedPrompt);
console.log(JSON.stringify(v6Format, null, 2));
```

### Option 4: Simplified Version for Your Use Case

For your specific high-qualified leads example, here's the simplified V6 format:

```json
{
  "sections": {
    "data": [
      "Read from Google Sheet MyLeads tab Leads",
      "Use stage column as qualification indicator",
      "Use Sales Person column for routing emails"
    ],
    "actions": [
      "Filter rows where stage equals 4",
      "Group by Sales Person column",
      "Handle missing Sales Person values separately"
    ],
    "output": [
      "Format as HTML table embedded in email",
      "Include columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person",
      "Show only leads for each salesperson in their email"
    ],
    "delivery": [
      "Send one email per salesperson to their email address",
      "CC meiribarak@gmail.com on all emails",
      "If zero high-qualified leads, email meiribarak@gmail.com with message: 0 high qualified leads found"
    ]
  }
}
```

## Using in the HTML Test Page

1. **Open the test page:**
   ```
   http://localhost:3000/test-v6.html
   ```

2. **Fill in the form:**

   **Data Sources field:**
   ```
   Read from Google Sheet MyLeads tab Leads
   ```

   **Actions field:**
   ```
   Filter rows where stage equals 4
   Group by Sales Person column
   ```

   **Output Format field:**
   ```
   Format as HTML table embedded in email
   Include columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person
   ```

   **Delivery field:**
   ```
   Send one email per salesperson to their email address
   CC meiribarak@gmail.com on all emails
   If zero high-qualified leads, email meiribarak@gmail.com with message: 0 high qualified leads found
   ```

3. **Click "Generate Plan"**

4. **Review the natural language plan that appears**

5. **Optionally edit with corrections**

6. **Click "Compile Workflow"** to see the final PILOT_DSL

## Quick Copy-Paste for Your Example

Just copy these values into the HTML form:

```
DATA SOURCES:
Read from Google Sheet "MyLeads" tab "Leads"
Use stage column for filtering (stage = 4)
Use Sales Person column for routing

ACTIONS:
Filter to rows where stage = 4
Group filtered rows by Sales Person
Handle missing Sales Person separately

OUTPUT FORMAT:
HTML table in email body
Columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person
One table per salesperson showing only their leads

DELIVERY:
Email each salesperson their filtered leads
CC meiribarak@gmail.com on all emails
If zero leads total, email meiribarak@gmail.com with: "0 high qualified leads found"
```

## API Testing Alternative

If you prefer to test via API directly:

```javascript
fetch('http://localhost:3000/api/v6/generate-workflow-plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    enhancedPrompt: {
      sections: {
        data: [
          'Read from Google Sheet "MyLeads" tab "Leads"',
          'Use stage column for filtering',
          'Use Sales Person column for email routing'
        ],
        actions: [
          'Filter to rows where stage = 4',
          'Group by Sales Person column',
          'Handle missing Sales Person values in separate email to Barak'
        ],
        output: [
          'Format as HTML table embedded in email',
          'Columns: Date, Lead Name, Company Email, Phone, Notes, Sales Person'
        ],
        delivery: [
          'Email each salesperson their filtered leads',
          'CC meiribarak@gmail.com on all emails',
          'If zero leads, email meiribarak@gmail.com: "0 high qualified leads found"'
        ]
      }
    },
    modelProvider: 'openai'
  })
})
.then(r => r.json())
.then(data => console.log(data))
```

---

**Summary:** The V6 HTML test page uses a simpler format than your Phase 3 enhanced prompt. You can either:
1. Manually type the simplified version into the form
2. Extract just the `sections` object and POST via API
3. Use the simplified formats shown above

The key difference is V6 doesn't need `processing_steps`, `specifics`, `plan_title`, or `plan_description` - it infers those from the sections!
