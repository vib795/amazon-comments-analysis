/**
 * Amazon Review Analyzer — Content Script
 * Injects the sidebar, fetches + parses review pages, and coordinates with the background worker.
 */

const SIDEBAR_ID = 'ara-sidebar';
const CACHE_PREFIX = 'ara_cache_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── ASIN extraction ──────────────────────────────────────────────────────────

function getASIN() {
  // Product detail page: /dp/ASIN
  let match = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  if (match) return match[1];
  // All-reviews page: /product-reviews/ASIN
  match = window.location.pathname.match(/\/product-reviews\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

// ─── Multi-page review fetching ───────────────────────────────────────────────

async function fetchAllReviews(asin, maxPages) {
  const allReviews = [];
  const domain = window.location.hostname;

  for (let page = 1; page <= maxPages; page++) {
    showLoading(`Fetching reviews — page ${page} of up to ${maxPages}…`);

    const url =
      `https://${domain}/product-reviews/${asin}` +
      `?pageNumber=${page}&reviewerType=all_reviews&sortBy=recent`;

    let html;
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
      if (!res.ok) break;
      html = await res.text();
    } catch {
      break;
    }

    const pageReviews = parseReviewsFromHTML(html);
    if (pageReviews.length === 0) break;

    allReviews.push(...pageReviews);

    if (!hasNextPage(html)) break;
  }

  return allReviews;
}

function parseReviewsFromHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const reviews = [];

  // Amazon uses both data-hook and id-based containers depending on page variant
  const reviewEls = doc.querySelectorAll('[data-hook="review"], [id^="customer_review-"]');

  reviewEls.forEach((el) => {
    // Amazon wraps body text in a nested span[data-hook="review-collapsed"] in newer page
    // structures, with span.review-text-content as a CSS-class fallback
    const bodyEl =
      el.querySelector('[data-hook="review-body"] span[data-hook="review-collapsed"]') ||
      el.querySelector('[data-hook="review-body"] span') ||
      el.querySelector('[data-hook="review-body"]') ||
      el.querySelector('span.review-text-content span') ||
      el.querySelector('span.review-text-content');
    const ratingEl = el.querySelector(
      '[data-hook="review-star-rating"] .a-icon-alt, ' +
      '[data-hook="cmps-review-star-rating"] .a-icon-alt'
    );
    const titleEl =
      el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)') ||
      el.querySelector('[data-hook="review-title"]');
    const verifiedEl = el.querySelector('[data-hook="avp-badge"]');

    const body = bodyEl ? bodyEl.textContent.trim() : null;
    const rating = parseFloat(ratingEl ? ratingEl.textContent : '') || null;
    const title = titleEl ? titleEl.textContent.trim() : null;
    const verified = !!verifiedEl;

    if (body && body.length > 10) {
      reviews.push({ body, rating, title, verified });
    }
  });

  return reviews;
}

function hasNextPage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Amazon marks the disabled next-page li with .a-disabled
  return !!doc.querySelector('.a-pagination .a-last:not(.a-disabled) a');
}

// ─── Product metadata (current page DOM) ─────────────────────────────────────

function getProductTitle() {
  // Product detail page
  let el = document.querySelector('#productTitle, #title');
  if (el) return el.innerText.trim();
  // Reviews page — product link in the header
  el = document.querySelector('[data-hook="product-link"]');
  if (el) return el.innerText.trim();
  return 'this product';
}

function getOverallRating() {
  const el = document.querySelector(
    '[data-hook="rating-out-of-text"], #acrPopover .a-icon-alt, #averageCustomerReviews .a-icon-alt'
  );
  return el ? el.innerText.trim() : null;
}

function getTotalReviewCount() {
  const el = document.querySelector(
    '[data-hook="total-review-count"], #acrCustomerReviewText'
  );
  return el ? el.innerText.trim() : null;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function getCached(asin) {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_PREFIX + asin, (result) => {
      const entry = result[CACHE_PREFIX + asin];
      if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
        resolve(entry.data);
      } else {
        resolve(null);
      }
    });
  });
}

async function setCache(asin, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [CACHE_PREFIX + asin]: { data, ts: Date.now() } },
      resolve
    );
  });
}

async function getMaxPages() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ maxPages: 5 }, (s) => resolve(s.maxPages));
  });
}

// ─── Sidebar injection ────────────────────────────────────────────────────────

function injectSidebar() {
  if (document.getElementById(SIDEBAR_ID)) return;

  const sidebar = document.createElement('div');
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `
    <div id="ara-header">
      <div id="ara-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        Review Analyzer
      </div>
      <div id="ara-header-actions">
        <button id="ara-toggle" title="Collapse sidebar">&#8249;</button>
      </div>
    </div>
    <div id="ara-body">
      <div id="ara-idle">
        <div id="ara-product-meta"></div>
        <button id="ara-analyze-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Analyze Reviews
        </button>
        <p id="ara-sub">Powered by Claude AI</p>
      </div>
      <div id="ara-loading" class="ara-hidden">
        <div class="ara-spinner"></div>
        <p id="ara-loading-text">Fetching reviews…</p>
      </div>
      <div id="ara-results" class="ara-hidden">
        <div id="ara-results-header">
          <div id="ara-sentiment-badge"></div>
          <button id="ara-refresh-btn" title="Re-analyze">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M1 4V10H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.51 15A9 9 0 1 0 5.5 5.5L1 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div id="ara-review-stats"></div>
        <div id="ara-authenticity" class="ara-hidden"></div>
        <div id="ara-sections"></div>
        <p id="ara-footer-note" class="ara-hidden"></p>
      </div>
      <div id="ara-error" class="ara-hidden">
        <div id="ara-error-icon">⚠</div>
        <p id="ara-error-msg"></p>
        <button id="ara-error-settings-btn" class="ara-hidden">Open Settings</button>
        <button id="ara-retry-btn">Try Again</button>
      </div>
    </div>
    <div id="ara-collapsed-tab" class="ara-hidden" title="Open Review Analyzer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </div>
  `;

  document.body.appendChild(sidebar);
  setupSidebarEvents(sidebar);
  populateProductMeta();
}

function populateProductMeta() {
  const metaEl = document.getElementById('ara-product-meta');
  if (!metaEl) return;
  const title = getProductTitle();
  const rating = getOverallRating();
  const count = getTotalReviewCount();
  if (title || rating) {
    metaEl.innerHTML = `
      <div class="ara-product-title">${escapeHtml(title.slice(0, 80))}${title.length > 80 ? '…' : ''}</div>
      ${rating || count ? `<div class="ara-product-rating">${rating || ''} ${count ? '· ' + count : ''}</div>` : ''}
    `;
  }
}

// ─── Sidebar state machine ────────────────────────────────────────────────────

function setupSidebarEvents(sidebar) {
  const toggleBtn = document.getElementById('ara-toggle');
  const collapsedTab = document.getElementById('ara-collapsed-tab');

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.add('ara-collapsed');
    collapsedTab.classList.remove('ara-hidden');
    toggleBtn.style.display = 'none';
  });

  collapsedTab.addEventListener('click', () => {
    sidebar.classList.remove('ara-collapsed');
    collapsedTab.classList.add('ara-hidden');
    toggleBtn.style.display = '';
  });

  document.getElementById('ara-analyze-btn').addEventListener('click', () => runAnalysis(false));
  document.getElementById('ara-refresh-btn').addEventListener('click', () => runAnalysis(true));
  document.getElementById('ara-retry-btn').addEventListener('click', () => runAnalysis(false));
  document.getElementById('ara-error-settings-btn').addEventListener('click', () =>
    chrome.runtime.openOptionsPage()
  );
}

function showLoading(message = 'Fetching reviews…') {
  document.getElementById('ara-idle').classList.add('ara-hidden');
  document.getElementById('ara-results').classList.add('ara-hidden');
  document.getElementById('ara-error').classList.add('ara-hidden');
  document.getElementById('ara-loading').classList.remove('ara-hidden');
  document.getElementById('ara-loading-text').textContent = message;
}

function showResults(data) {
  document.getElementById('ara-loading').classList.add('ara-hidden');
  document.getElementById('ara-idle').classList.add('ara-hidden');
  document.getElementById('ara-error').classList.add('ara-hidden');
  document.getElementById('ara-results').classList.remove('ara-hidden');
  renderResults(data);
}

function showError(message, showSettingsBtn = false) {
  document.getElementById('ara-loading').classList.add('ara-hidden');
  document.getElementById('ara-idle').classList.add('ara-hidden');
  document.getElementById('ara-results').classList.add('ara-hidden');
  document.getElementById('ara-error').classList.remove('ara-hidden');
  document.getElementById('ara-error-msg').textContent = message;
  const settingsBtn = document.getElementById('ara-error-settings-btn');
  settingsBtn.classList.toggle('ara-hidden', !showSettingsBtn);
}

// ─── Analysis runner ──────────────────────────────────────────────────────────

async function runAnalysis(forceRefresh = false) {
  const asin = getASIN();
  if (!asin) {
    showError("Couldn't detect a product on this page.");
    return;
  }

  if (!forceRefresh) {
    const cached = await getCached(asin);
    if (cached) {
      showResults(cached);
      return;
    }
  }

  const maxPages = await getMaxPages();
  const reviews = await fetchAllReviews(asin, maxPages);

  if (reviews.length === 0) {
    showError('No reviews could be fetched. The product may have no reviews yet.');
    return;
  }

  showLoading(`Analyzing ${reviews.length} reviews with Claude…`);

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_REVIEWS', reviews, productTitle: getProductTitle(), asin },
    async (response) => {
      if (chrome.runtime.lastError) {
        showError('Extension error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (response.error) {
        const isApiKeyError =
          response.error.includes('API key') ||
          response.error.includes('401') ||
          response.error.includes('403');
        showError(response.error, isApiKeyError);
        return;
      }
      await setCache(asin, response.data);
      showResults(response.data);
    }
  );
}

// ─── Result rendering ─────────────────────────────────────────────────────────

function renderResults(data) {
  renderSentimentBadge(data.sentimentScore, data.sentimentLabel);
  renderReviewStats(data.reviewCount, data.analyzedCount);
  renderAuthenticity(data.authenticity);
  renderSections(data.pros, data.cons, data.issues);
  renderFooterNote(data.reviewCount, data.analyzedCount);
}

function renderSentimentBadge(score, label) {
  const el = document.getElementById('ara-sentiment-badge');
  if (!el) return;
  const color = score >= 70 ? 'positive' : score >= 45 ? 'neutral' : 'negative';
  el.className = `ara-sentiment ara-sentiment--${color}`;
  el.innerHTML = `
    <span class="ara-sentiment-score">${score}%</span>
    <span class="ara-sentiment-label">${escapeHtml(label || 'Overall Sentiment')}</span>
  `;
}

function renderReviewStats(total, analyzed) {
  const el = document.getElementById('ara-review-stats');
  if (!el) return;
  if (total > analyzed) {
    el.textContent = `${total} reviews fetched · ${analyzed} sent to Claude`;
  } else {
    el.textContent = `Based on ${analyzed} review${analyzed !== 1 ? 's' : ''}`;
  }
}

function renderAuthenticity(auth) {
  const el = document.getElementById('ara-authenticity');
  if (!el || !auth) return;
  if (auth.suspicious) {
    el.classList.remove('ara-hidden');
    el.innerHTML = `
      <div class="ara-auth-warning">
        <span class="ara-auth-icon">⚠</span>
        <div>
          <strong>Review Authenticity Warning</strong>
          <p>${escapeHtml(auth.reason)}</p>
        </div>
      </div>
    `;
  } else {
    el.classList.add('ara-hidden');
  }
}

function renderSections(pros, cons, issues) {
  const el = document.getElementById('ara-sections');
  if (!el) return;
  let html = '';

  if (pros && pros.length) {
    html += buildSection('Positives', pros, 'positive', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `);
  }

  if (cons && cons.length) {
    html += buildSection('Negatives', cons, 'negative', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `);
  }

  if (issues && issues.length) {
    html += buildSection('Issues & Defects', issues, 'issues', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 0 0 3.54 21H20.46A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `);
  }

  el.innerHTML = html || '<p class="ara-no-data">No clear patterns found in these reviews.</p>';
}

function buildSection(title, items, type, iconSvg) {
  const itemsHtml = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `
    <div class="ara-section ara-section--${type}">
      <div class="ara-section-header">
        <span class="ara-section-icon">${iconSvg}</span>
        <span class="ara-section-title">${escapeHtml(title)}</span>
        <span class="ara-section-count">${items.length}</span>
      </div>
      <ul class="ara-section-list">${itemsHtml}</ul>
    </div>
  `;
}

function renderFooterNote(total, analyzed) {
  const el = document.getElementById('ara-footer-note');
  if (!el) return;
  if (total > analyzed) {
    el.textContent = `${total} reviews fetched; ${analyzed} sent to Claude. Increase "Max pages" in Settings to analyze more.`;
    el.classList.remove('ara-hidden');
  } else {
    el.classList.add('ara-hidden');
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  if (!getASIN()) return;
  injectSidebar();
}

init();
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(() => {
      if (!document.getElementById(SIDEBAR_ID)) init();
    }, 1500);
  }
}).observe(document, { subtree: true, childList: true });
