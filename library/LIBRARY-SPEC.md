# Library Specification v1.0

## Overview

Library is the unified browsing interface for all Nordson ICS visual assets. It provides access to archived stock imagery, publications, and deliverables produced through the Ascend workflow.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   LOCAL MACHINE                    GOOGLE DRIVE                 │
│   ─────────────                    ────────────                 │
│                                                                 │
│   Physical Drive                   Fileroom/                    │
│   ┌──────────────┐                 ┌────────────────────┐       │
│   │ LIBRARY/     │                 │ Fileroom Registry  │       │
│   │  └─ STOCK/   │                 │ Tags Master        │       │
│   │ PUBLICATIONS/│                 │ qr_library/        │       │
│   └──────────────┘                 │ Deliverables/      │       │
│         │                          └─────────┬──────────┘       │
│         │                                    │                  │
│         │         ┌──────────┐               │                  │
│         │         │  DAVE    │───────────────┘                  │
│         │         │ (courier)│  upload_deliverable()            │
│         │         └──────────┘                                  │
│         │                                                       │
│         └────────────────┬───────────────────┘                  │
│                          ▼                                      │
│                 ┌─────────────────┐                             │
│                 │    LIBRARY UI   │                             │
│                 └─────────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### 1. Stock & Publications (Physical Drive)

| Path | Description |
|------|-------------|
| `/Volumes/Today/Nordson/LIBRARY/STOCK/` | Archived stock photography, logos, icons |
| `/Volumes/Today/Nordson/PUBLICATIONS/` | Finished publication artwork |

- **Metadata**: Tags Master Google Sheet (ASSETS tab)
- **Thumbnails**: Pre-generated WebP files in `library/thumbs/`
- **Access**: Read-only archive (source of truth)

### 2. Deliverables (Google Drive)

| Location | Description |
|----------|-------------|
| Google Drive `Fileroom/Deliverables/` | Finals uploaded by Dave |

- **Metadata**: Fileroom Registry Google Sheet
- **Source**: Exclusively from Dave's outbox
- **Workflow**: ArtStart/CopyDesk/CodeDesk → Fileroom Registry → Dave → Deliverables

### 3. QR Library (Google Drive)

| Location | Description |
|----------|-------------|
| Google Drive `Fileroom/qr_library/` | QR codes from CodeDesk |

- **Metadata**: Fileroom Registry (Kind: output, AssetType: qr)

---

## Google Sheets

### Tags Master
**Sheet ID**: `1ZtR9Jv64Jogrvx77drQGNosCo0-sjDMTulC_Q__TpQQ`

#### TAB 1: TAXONOMY (gid=0)
Product/tag definitions and lines of business.

| Column | Description |
|--------|-------------|
| Name | Product name (e.g., "Encore", "iTrax") |
| Tags | Associated tags |
| LOB | Line of Business |

#### TAB 2: ASSETS (new)
Asset metadata for Stock/Publications.

| Column | Description |
|--------|-------------|
| AssetId | MD5 hash of path (12 chars) |
| Path | Full path (e.g., "library/STOCK/LOGOS/...") |
| Products | Comma-separated product assignments |
| Tags | Comma-separated tags |
| TrashedAt | ISO timestamp if soft-deleted |
| TrashedBy | Email of user who trashed |
| UpdatedAt | Last modification timestamp |

### Fileroom Registry
**Sheet ID**: `1M48XhZsvUyy_tJt8Tz2kf9zxOQIKx6vBTkxKyeGtCCM`

Tracks all jobs from Ascend apps. Key fields for Library:

| Column | Description |
|--------|-------------|
| AscendJobKey | Unique identifier |
| App | Source app (ARTSTART, COPYDESK, CODEDESK) |
| Kind | "working" or "output" |
| Status | Job status |
| DrivePngFileId | Google Drive file ID |
| DrivePngOpenUrl | Direct link to file |
| OwnerEmail | Job owner |

---

## User Interface

### Navigation: Two-Mode Toggle

A pill button toggles between **Browse** and **Tags** modes.

```
┌─────────────────────────────────────────────────────────────────┐
│  LIBRARY                                    [ Browse │ Tags ]   │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                              │
│   LEFT SIDEBAR   │              MAIN CONTENT AREA               │
│   (mode-specific)│                                              │
│                  │                                              │
└──────────────────┴──────────────────────────────────────────────┘
```

### Browse Mode

Finder-style folder navigation.

**Sidebar:**
- Top-level sources as "drives":
  - Stock
  - Publications
  - Fileroom (deliverables)
- Collapsible folder tree OR visual folder tiles

**Main Content:**
- Visual folder tiles with preview mosaics (4-up thumbnail grid per folder)
- Click folder → drill into contents
- Breadcrumb navigation at top
- Files display as thumbnail grid

**Folder Tile Example:**
```
┌─────────────────┐
│ ┌─────┬─────┐   │
│ │ img │ img │   │
│ ├─────┼─────┤   │
│ │ img │ img │   │
│ └─────┴─────┘   │
│   LOGOS (47)    │
└─────────────────┘
```

### Tags Mode

Filter-based discovery.

**Sidebar:**
- Products list (checkboxes)
- Tags list (checkboxes)
- File types (PSD, AI, EPS, PDF, etc.)
- Filters (Untagged, Trash)

**Main Content:**
- Active filters displayed prominently as pills
- Thumbnail grid of matching assets
- Clear indication of what filters are applied

**Active Filters Display:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Showing: [Encore ×] [booth ×] [PSD ×]              Clear All   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [thumb] [thumb] [thumb] [thumb] [thumb] [thumb]              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Roles

### Admin
- Full access to all features
- Can assign products/tags to assets
- Can trash/restore assets
- Can reveal files in Finder (local only)
- Can view trash

### Non-Admin (End User)
- View all assets
- Download full-size deliverables (paid-for finals)
- Add to cart / request assets
- Cannot tag or trash

---

## Asset Detail Modal

Displays when clicking an asset thumbnail.

**Preview Section:**
- Large preview image
- File type badge

**Info Section:**
- Filename
- Dimensions (width × height)
- DPI (if available)
- File size
- Modified date

**Actions:**
- Add to Cart (all users)
- Download (deliverables - non-admin)
- Reveal in Finder (admin only, local assets)
- Trash / Restore (admin only)

**Tagging (Admin):**
- Product picker (multi-select from TAXONOMY)
- Tag picker (multi-select from TAXONOMY)

---

## Data Flow

### Stock/Publications (Local Assets)

```
1. generate-manifest.py scans physical drive
   → Outputs library-manifest.json

2. generate-thumbs.py creates thumbnails
   → Outputs thumbs/*.webp

3. Library UI loads manifest + Tags Master
   → Merges file data with metadata

4. Admin tags an asset
   → Writes to Tags Master (ASSETS tab) via Apps Script API
```

### Deliverables (Google Drive)

```
1. Job created in ArtStart/CopyDesk/CodeDesk
   → Registered in Fileroom Registry

2. Dave creates seed files locally (Inbox)

3. Designer completes work, drops in Dave's Outbox

4. Dave uploads to Google Drive Fileroom/Deliverables/
   → Updates Fileroom Registry with file URL

5. Library UI queries Fileroom Registry
   → Displays deliverables alongside Stock/Publications
```

---

## API Requirements

### Tags Master Apps Script (New)

Endpoints needed:

| Action | Description |
|--------|-------------|
| `listTaxonomy` | Get products/tags/LOB |
| `getAssetMeta` | Get metadata for asset by ID |
| `upsertAssetMeta` | Set products/tags for asset |
| `trashAsset` | Soft-delete asset |
| `restoreAsset` | Restore trashed asset |
| `listTrashedAssets` | Get all trashed assets |

### Fileroom Registry (Existing)

Already supports:
- `listJobsForUser` - Get deliverables by owner
- `trashJob` / `restoreJob` - Soft delete

May need:
- `listDeliverables` - Get all delivered outputs for Library view

---

## Thumbnail Strategy

| Format | Method | Tool |
|--------|--------|------|
| PSD | Composite extraction | psd-tools |
| AI | PDF rendering | PyMuPDF |
| EPS | PostScript rendering | Ghostscript + Pillow |
| INDD | Skip (use PDF deliverable) | — |
| PDF | Page rendering | PyMuPDF |
| JPG/PNG/WebP | Direct resize | Pillow |

**Specs:**
- Format: WebP
- Quality: 82%
- Max dimension: 1600px (longest edge)

---

## File Structure

```
/Volumes/Today/ascend-portal/library/
├── index.html              # Main UI
├── library.js              # Application logic
├── library.css             # Styles
├── library-manifest.json   # Asset index (generated)
├── library-assets.json     # Legacy local metadata (deprecated)
├── thumbs/                 # Generated thumbnails
│   └── {assetId}.webp
├── generate-manifest.py    # Scans physical drive
├── generate-thumbs.py      # Creates thumbnails
├── reveal-server.py        # Finder integration (admin)
└── LIBRARY-SPEC.md         # This document
```

---

## Integration Points

### From Fileroom UI
- "Go →" button links to Library with context (job ID, filter)

### From ArtStart
- View related assets for a job
- Link to deliverable in Library

### From Dave
- `upload_deliverable()` makes files visible in Library

---

## Future Considerations

1. **Search** - Full-text search across filenames, tags, products
2. **Collections** - User-curated groups of assets
3. **Versions** - Track revisions of deliverables
4. **Permissions** - Per-asset or per-folder access control
5. **Analytics** - Track downloads, popular assets
6. **Sync** - Push pruned index back to physical drive

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create ASSETS tab in Tags Master
- [ ] Build Apps Script API for Tags Master
- [ ] Refactor UI to two-mode toggle (Browse/Tags)
- [ ] Implement Browse mode with folder navigation
- [ ] Migrate from localStorage to Sheet-backed metadata

### Phase 2: Polish
- [ ] Folder preview mosaics
- [ ] Breadcrumb navigation
- [ ] Active filter pills in Tags mode
- [ ] Improve thumbnail loading/caching

### Phase 3: Integration
- [ ] Connect to Fileroom Registry for deliverables
- [ ] "Go →" deep linking from Fileroom
- [ ] Non-admin download flow for deliverables

### Phase 4: Enhancement
- [ ] Search functionality
- [ ] Batch tagging
- [ ] Export/reporting

---

*Last updated: 2025-01-24*
