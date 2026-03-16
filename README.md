# Amazon Review Analyzer

A Chrome extension that reads Amazon product reviews for you. Instead of skimming through dozens of comments, click one button and get an AI-powered summary of what buyers actually say — the positives, negatives, specific defects, and an authenticity check for suspicious reviews.

Powered by [Claude AI](https://anthropic.com).

---

## What it does

When you visit an Amazon product page or reviews page, a collapsible sidebar appears on the right. Hit **Analyze Reviews** and within seconds you get:

| Section | What you see |
|---|---|
| **Sentiment score** | 0–100% positive with a plain-English label |
| **Positives** | Up to 6 specific things buyers love |
| **Negatives** | Up to 6 common complaints |
| **Issues & Defects** | Concrete problems (e.g. "Charging cable frays after 2 weeks") |
| **Authenticity warning** | Flags if the review distribution looks suspicious |

Reviews are fetched across multiple pages automatically — not just what's visible on screen.

---

## Installation

### Option A — Chrome Web Store *(recommended)*

> Coming soon. Search for **Amazon Review Analyzer** in the [Chrome Web Store](https://chrome.google.com/webstore).

### Option B — Load unpacked (for developers)

1. [Download or clone this repository](https://github.com/) and unzip if needed.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. The extension icon will appear in your toolbar.

---

## Setup: adding your API key

The extension uses the [Anthropic API](https://www.anthropic.com). You need a free API key to use it.

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in (or create a free account).
2. Navigate to **API Keys** and create a new key.
3. Click the **Amazon Review Analyzer** icon in your Chrome toolbar.
4. Click **Settings** (or go to `chrome://extensions` → Amazon Review Analyzer → Extension options).
5. Paste your API key into the **API Key** field and click **Save Settings**.

You're ready to go. Navigate to any Amazon product page and the sidebar will appear.

---

## Settings

Open the extension's **Settings** page to configure:

| Setting | Options | Default |
|---|---|---|
| **API Key** | Your Anthropic API key | — |
| **Model** | Claude Haiku 4.5 (fast, affordable) / Claude Sonnet 4.6 (higher quality) | Haiku 4.5 |
| **Max pages to fetch** | 3 pages (~30 reviews), 5 pages (~50), 10 pages (~100) | 5 pages |

You can also **Clear Cached Results** to force a fresh analysis on your next visit to a product.

---

## Privacy & API key security

Your API key is sensitive. Here is exactly how this extension handles it:

### Storage
- Your key is saved in **`chrome.storage.sync`** — Chrome's built-in encrypted storage that syncs across your signed-in devices. It is never written to disk in plaintext, never stored in `localStorage`, and never embedded in the extension itself.

### Transmission
- The key is read **only inside `background.js`** (the extension's background service worker). It is passed directly as an HTTP header to `api.anthropic.com` and nowhere else.
- The key **never touches the content script** (`content.js`) that runs alongside the Amazon page. Amazon's own page JavaScript operates in a completely separate sandbox and has no way to access Chrome extension storage or variables.

### What leaves your browser
| Data sent | Destination | Purpose |
|---|---|---|
| Review text (truncated to 600 chars each) | Anthropic API | AI analysis |
| Product title | Anthropic API | Context for the summary |
| Your API key (as a header) | Anthropic API | Authentication |

Nothing is sent to any server other than Anthropic's API. There is no analytics, no telemetry, no third-party service.

### Source code
This extension is open source. You can read every line before installing it:
- `content.js` — fetches review pages from Amazon and injects the sidebar UI
- `background.js` — the only file that ever sees your API key; calls Claude
- `options.js` / `popup.js` — settings UI; reads/writes to `chrome.storage.sync`

---

## Supported Amazon regions

- amazon.com · amazon.co.uk · amazon.ca · amazon.com.au
- amazon.de · amazon.fr · amazon.it · amazon.es

---

## Cost

Each analysis call uses approximately **2,000–8,000 tokens** depending on how many pages you fetch. At Claude Haiku 4.5 pricing this is a fraction of a cent per product.

Anthropic provides free credits when you sign up. See [anthropic.com/pricing](https://www.anthropic.com/pricing) for current rates.

---

## Troubleshooting

**Sidebar doesn't appear**
Make sure you're on a product detail page (URL contains `/dp/`) or the reviews page (URL contains `/product-reviews/`). The extension doesn't activate on search results or category pages.

**"No reviews could be fetched"**
The product may have no reviews, or Amazon may have updated their page structure. Try refreshing the Amazon page and clicking Analyze again.

**Analysis seems incomplete**
Increase **Max pages to fetch** in Settings (up to 10 pages / ~100 reviews).

**"Invalid API key"**
Double-check your key at [console.anthropic.com](https://console.anthropic.com). Make sure there are no extra spaces and that the key starts with `sk-ant-`.

---

## Development

No build step required — this is plain JavaScript with Manifest V3.

```
amazon-comments-analysis/
├── manifest.json      Chrome extension manifest (MV3)
├── content.js         Injected into Amazon pages — fetches reviews, renders sidebar
├── sidebar.css        Sidebar styles
├── background.js      Service worker — Claude API calls only
├── options.html/js/css  Settings page
├── popup.html/js/css    Toolbar popup
└── icons/             Extension icons (16, 48, 128px)
```

To make changes: edit the files, go to `chrome://extensions`, and click the **refresh icon** on the extension card.

---

## License

MIT
