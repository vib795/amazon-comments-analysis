/**
 * Amazon Review Analyzer — Content Script
 * Injects the sidebar, scrapes reviews, and coordinates with the background worker.
 */

const SIDEBAR_ID = 'ara-sidebar';
const CACHE_PREFIX = 'ara_cache_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── ASIN extraction ──────────────────────────────────────────────────────────

function getASIN() {
  // Product detail page: /dp/ASIN or /gp/product/ASIN
  let match = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  if (match) return match[1];
  // All-reviews page: /product-reviews/ASIN
  match = window.location.pathname.match(/\/product-reviews\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

// ─── Review scraping ─────────────────────────────────────────────────────────

function scrapeReviews() {
  const reviews = [];

  // Primary selector (product detail page reviews section)
  const reviewElements = document.querySelectorAll(
    '[data-hook="review"], .review, [id^="customer_review-"]'
  );

  reviewElements.forEach((el) => {
    const bodyEl = el.querySelector(
      '[data-hook="review-body"] span, .review-text-content span, [data-hook="review-body"]'
    );
    const ratingEl = el.querySelector(
      '[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt'
    );
    const titleEl = el.querySelector(
      '[data-hook="review-title"] span:not(.a-icon-alt), .review-title span'
    );
    const verifiedEl = el.querySelector('[data-hook="avp-badge"], .avp-badge');
    const dateEl = el.querySelector('[data-hook="review-date"], .review-date');

    const body = bodyEl ? bodyEl.innerText.trim() : null;
    const ratingText = ratingEl ? ratingEl.innerText : '';
    const rating = parseFloat(ratingText) || null;
    const title = titleEl ? titleEl.innerText.trim() : null;
    const verified = !!verifiedEl;
    const date = dateEl ? dateEl.innerText.trim() : null;

    if (body && body.length > 10) {
      reviews.push({ body, rating, title, verified, date });
    }
  });

  return reviews;
}

function getProductTitle() {
  const el = document.querySelector('#productTitle, #title');
  return el ? el.innerText.trim() : 'this product';
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
    chrome.storage.local.set({ [CACHE_PREFIX + asin]: { data, ts: Date.now() } }, resolve);
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
        <p id="ara-loading-text">Reading reviews...</p>
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
        <p id="ara-footer-note"></p>
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
      ${rating || count ? `<div class="ara-product-rating">${rating ? rating : ''} ${count ? '· ' + count : ''}</div>` : ''}
    `;
  }
}

// ─── Sidebar state machine ────────────────────────────────────────────────────

let isCollapsed = false;

function setupSidebarEvents(sidebar) {
  const toggleBtn = document.getElementById('ara-toggle');
  const collapsedTab = document.getElementById('ara-collapsed-tab');
  const analyzeBtn = document.getElementById('ara-analyze-btn');
  const refreshBtn = document.getElementById('ara-refresh-btn');
  const retryBtn = document.getElementById('ara-retry-btn');
  const settingsBtn = document.getElementById('ara-error-settings-btn');

  toggleBtn.addEventListener('click', () => {
    isCollapsed = true;
    sidebar.classList.add('ara-collapsed');
    collapsedTab.classList.remove('ara-hidden');
    toggleBtn.style.display = 'none';
  });

  collapsedTab.addEventListener('click', () => {
    isCollapsed = false;
    sidebar.classList.remove('ara-collapsed');
    collapsedTab.classList.add('ara-hidden');
    toggleBtn.style.display = '';
  });

  analyzeBtn.addEventListener('click', () => runAnalysis(false));
  refreshBtn.addEventListener('click', () => runAnalysis(true));
  retryBtn.addEventListener('click', () => runAnalysis(false));

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  }
}

function showLoading(message = 'Reading reviews...') {
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
  if (showSettingsBtn) {
    settingsBtn.classList.remove('ara-hidden');
  } else {
    settingsBtn.classList.add('ara-hidden');
  }
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

  showLoading('Reading reviews...');
  const reviews = scrapeReviews();

  if (reviews.length === 0) {
    showError('No reviews found on this page. Try scrolling to the reviews section first.');
    return;
  }

  showLoading(`Analyzing ${reviews.length} review${reviews.length !== 1 ? 's' : ''} with Claude…`);

  const productTitle = getProductTitle();

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_REVIEWS', reviews, productTitle, asin },
    async (response) => {
      if (chrome.runtime.lastError) {
        showError('Extension error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (response.error) {
        const isApiKeyError = response.error.includes('API key') || response.error.includes('401') || response.error.includes('403');
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
  el.textContent = `Based on ${analyzed} review${analyzed !== 1 ? 's' : ''} analyzed`;
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
  const itemsHtml = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
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
    el.textContent = `Only visible reviews were analyzed. Scroll down to load more reviews, then re-analyze.`;
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
  const asin = getASIN();
  if (!asin) return;
  injectSidebar();
}

// Run on load; also re-check after SPA navigation
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
