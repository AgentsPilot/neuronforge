# Google Drive Picker Integration

> **Status:** Planning & POC Phase
> **Last Updated:** December 2024

---

## Objective

Allow users to select files from their Google Drive (including Google Sheets, Docs, and Folders) when providing input parameters to agents, instead of manually entering file IDs.

### Use Case

When a user runs an agent that requires a Google file/folder ID as input:
1. User sees a "Select from Drive" button instead of a text input
2. User clicks the button → Google Picker modal opens
3. User selects the file → Full metadata is captured (id, name, mimeType, url, etc.)
4. Agent receives the file ID and proceeds

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **New input types** | `google_file`, `google_sheet`, `google_doc`, `google_folder` | Easier to implement, explicit typing |
| **Token source** | Any connected Google plugin | User may have google-drive, google-sheets, etc. - use whichever has a valid token |
| **Picker library** | `@googleworkspace/drive-picker-element` | Official Google web component, simpler than raw Picker API |
| **No token fallback** | Show error with link to connect | Don't trigger OAuth inline during agent input |

---

## Implementation Status

### Completed (POC)

- [x] Installed `@googleworkspace/drive-picker-element` package
- [x] Created API endpoint to retrieve Google OAuth token (`/api/plugins/google-token`)
- [x] Created React wrapper component (`GoogleDrivePicker.tsx`)
- [x] Added test page tab for manual testing (`/test-plugins-v2` → Google Picker tab)

### Not Started

- [ ] Add new input types to agent schema (`google_file`, `google_sheet`, `google_doc`, `google_folder`)
- [ ] Integrate picker into agent creation flow (`v2/agents/new`)
- [ ] Replace chat-based input with picker UI for Google file types
- [ ] Handle selected file metadata in `inputParameterValues`
- [ ] Test end-to-end with real agent execution

---

## Files Created (Stashed)

All POC code is currently stashed:

```bash
git stash list
# stash@{0}: On main: Google Picker integration WIP
```

| File | Description |
|------|-------------|
| `app/api/plugins/google-token/route.ts` | API to get OAuth token from any Google plugin |
| `lib/client/GoogleDrivePicker.tsx` | React component wrapping the picker web component |
| `app/test-plugins-v2/page.tsx` | Modified to add "Google Picker" test tab |
| `package.json` | Added `@googleworkspace/drive-picker-element` dependency |

**To restore:**
```bash
git stash pop
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Input Phase (v2/agents/new)                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Input type: google_sheet                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  [Select Google Sheet]  ← Button triggers picker│  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GoogleDrivePickerButton                                    │
│  - Fetches token from /api/plugins/google-token             │
│  - Opens drive-picker-element modal                         │
│  - Returns GoogleFileMetadata on selection                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GoogleFileMetadata                                         │
│  {                                                          │
│    id: "1abc...xyz",                                        │
│    name: "Q3 Sales Report",                                 │
│    mimeType: "application/vnd.google-apps.spreadsheet",     │
│    url: "https://docs.google.com/spreadsheets/d/...",       │
│    iconUrl: "...",                                          │
│    sizeBytes: 12345                                         │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## MIME Type Mapping

| Input Type | MIME Filter |
|------------|-------------|
| `google_file` | No filter (all files) |
| `google_sheet` | `application/vnd.google-apps.spreadsheet` |
| `google_doc` | `application/vnd.google-apps.document` |
| `google_folder` | `application/vnd.google-apps.folder` |

---

## Prerequisites

1. **Environment Variable:** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` must be set
2. **Google Cloud Console:** Picker API must be enabled
3. **User Connection:** At least one Google plugin must be connected (google-drive, google-sheets, etc.)

---

## Next Steps

1. **Test POC:** Restore stash, run dev server, test picker on `/test-plugins-v2`
2. **Validate API Key:** Confirm `NEXT_PUBLIC_GOOGLE_CLIENT_ID` works with Picker API
3. **Integrate into Agent Flow:** Add picker to `v2/agents/new` input collection phase
4. **Add Input Types:** Extend `InputField.type` union with Google types
