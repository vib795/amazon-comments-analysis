/**
 * Amazon Review Analyzer — Background Service Worker
 * Handles Claude API calls to keep the API key out of the content script.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_REVIEWS_PER_CALL = 50;
const MAX_REVIEW_CHARS = 600;

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_REVIEWS') {
    handleAnalysis(message).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message || 'Unknown error occurred.' });
    });
    return true; // keep channel open for async response
  }
});

// ─── Main analysis handler ────────────────────────────────────────────────────

async function handleAnalysis({ reviews, productTitle, asin }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    return {
      error:
        'No API key configured. Please add your Anthropic API key in the extension settings.',
    };
  }

  // Limit and truncate reviews to stay within token limits
  const selected = reviews.slice(0, MAX_REVIEWS_PER_CALL);
  const truncated = selected.map((r) => ({
    ...r,
    body: r.body.length > MAX_REVIEW_CHARS ? r.body.slice(0, MAX_REVIEW_CHARS) + '…' : r.body,
  }));

  const prompt = buildPrompt(productTitle, truncated);
  const model = settings.model || DEFAULT_MODEL;

  let responseText;
  try {
    responseText = await callClaude(settings.apiKey, model, prompt);
  } catch (err) {
    return { error: formatApiError(err) };
  }

  let parsed;
  try {
    parsed = parseResponse(responseText, truncated.length);
  } catch (err) {
    return { error: 'Failed to parse AI response. Please try again.' };
  }

  return { data: parsed };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(productTitle, reviews) {
  const reviewsText = reviews
    .map((r, i) => {
      const parts = [`[${i + 1}]`];
      if (r.rating) parts.push(`${r.rating}/5 stars`);
      if (r.verified) parts.push('verified purchase');
      if (r.title) parts.push(`Title: "${r.title}"`);
      parts.push(`Review: ${r.body}`);
      return parts.join(' | ');
    })
    .join('\n\n');

  return `You are analyzing Amazon customer reviews for: "${productTitle}".

Here are ${reviews.length} customer reviews:

${reviewsText}

Analyze these reviews and respond with ONLY a valid JSON object (no markdown, no code blocks) in exactly this format:
{
  "sentimentScore": <integer 0-100, overall positive sentiment percentage>,
  "sentimentLabel": "<short label like 'Mostly Positive', 'Mixed Reviews', 'Mostly Negative'>",
  "pros": [<up to 6 concise bullet points about what customers love, each under 80 chars>],
  "cons": [<up to 6 concise bullet points about common complaints, each under 80 chars>],
  "issues": [<up to 5 specific defects/problems mentioned e.g. 'Battery drains within 2 hours', each under 80 chars>],
  "authenticity": {
    "suspicious": <true if reviews seem fake/astroturfed, false otherwise>,
    "reason": "<brief explanation if suspicious, empty string otherwise>"
  }
}

Rules:
- Be specific and concrete, not vague (e.g. "Strap broke after 3 weeks" not "Quality issues")
- Only include items genuinely supported by the reviews
- If there are no issues/defects, return an empty array for "issues"
- For authenticity: flag if >80% are 5-star with generic short praise, or if reviews seem copy-pasted`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaude(apiKey, model, prompt) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(text, analyzedCount) {
  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    sentimentScore: clamp(parseInt(parsed.sentimentScore, 10) || 50, 0, 100),
    sentimentLabel: String(parsed.sentimentLabel || 'Mixed Reviews'),
    pros: sanitizeArray(parsed.pros, 6),
    cons: sanitizeArray(parsed.cons, 6),
    issues: sanitizeArray(parsed.issues, 5),
    authenticity: {
      suspicious: !!parsed.authenticity?.suspicious,
      reason: String(parsed.authenticity?.reason || ''),
    },
    analyzedCount,
    reviewCount: analyzedCount,
  };
}

function sanitizeArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, max)
    .map((item) => item.trim());
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// ─── Error formatting ─────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(status, body) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

function formatApiError(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid API key. Please check your Anthropic API key in settings.';
    if (err.status === 403) return 'API key does not have permission. Please verify your Anthropic API key.';
    if (err.status === 429) return 'Rate limit reached. Please wait a moment and try again.';
    if (err.status === 529 || err.status === 503) return 'Claude is overloaded right now. Please try again in a moment.';
    if (err.status >= 500) return 'Claude API is temporarily unavailable. Please try again.';
    try {
      const body = JSON.parse(err.body);
      if (body.error?.message) return `API error: ${body.error.message}`;
    } catch {}
    return `API error (${err.status}). Please try again.`;
  }
  if (err.name === 'TypeError' && err.message.includes('fetch')) {
    return 'Network error. Please check your internet connection.';
  }
  return err.message || 'An unexpected error occurred.';
}

// ─── Settings helper ──────────────────────────────────────────────────────────

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ apiKey: '', model: DEFAULT_MODEL }, resolve);
  });
}
