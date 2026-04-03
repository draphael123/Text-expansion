# SnapText — Chrome Extension

## Quick Start

### 1. Install the Extension (Developer Mode)
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `snaptext-extension` folder
4. SnapText icon appears in your toolbar

### 2. Use It
- Type `;sig` then press **Space** → expands to your signature
- Type `;today` then press **Space** → inserts today's date
- Click the toolbar icon to browse/search macros
- Click ⚙ to open the full dashboard

### 3. Set Up Cloud Sync (Optional)
1. Create a free [Supabase](https://supabase.com) project
2. Run `snaptext-supabase/schema.sql` in the Supabase SQL Editor
3. In SnapText Dashboard → Settings, enter your Supabase URL and anon key
4. Go to Account → Create Account or Sign In
5. Your macros now sync across all devices

## Default Macros
| Trigger | Expansion | Folder |
|---------|-----------|--------|
| `;sig` | Best regards, [Name] | Email |
| `;today` | Current date | Dates |
| `;now` | Current time | Dates |
| `;cb` | Clipboard contents | Utility |
| `;reply` | Email reply template | Email |

## Variables
- `{{date}}` — Today's date
- `{{time}}` — Current time
- `{{clipboard}}` — Clipboard contents
- `{{cursor}}` — Place cursor after expansion
- `{{input:Label}}` — Prompt for a value

## File Structure
```
snaptext-extension/    Chrome extension (load unpacked)
snaptext-supabase/     SQL schema for Supabase
snaptext-landing/      Landing page (single HTML file)
```
