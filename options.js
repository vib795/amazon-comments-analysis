const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model-select');
const maxPagesSelect = document.getElementById('max-pages');
const toggleKeyBtn = document.getElementById('toggle-key');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const cacheStatus = document.getElementById('cache-status');

// Load saved settings
chrome.storage.sync.get({ apiKey: '', model: 'claude-haiku-4-5-20251001', maxPages: 5 }, (settings) => {
  apiKeyInput.value = settings.apiKey;
  modelSelect.value = settings.model;
  maxPagesSelect.value = String(settings.maxPages);
});

// Toggle API key visibility
toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyBtn.title = 'Hide key';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyBtn.title = 'Show key';
  }
});

// Save settings
document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const maxPages = parseInt(maxPagesSelect.value, 10);

  chrome.storage.sync.set({ apiKey, model, maxPages }, () => {
    showStatus(saveStatus, 'Settings saved!', false);
  });
});

// Clear cache
clearCacheBtn.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    const cacheKeys = Object.keys(items).filter((k) => k.startsWith('ara_cache_'));
    if (cacheKeys.length === 0) {
      showStatus(cacheStatus, 'No cache to clear.', false);
      return;
    }
    chrome.storage.local.remove(cacheKeys, () => {
      showStatus(cacheStatus, `Cleared ${cacheKeys.length} cached result${cacheKeys.length !== 1 ? 's' : ''}.`, false);
    });
  });
});

function showStatus(el, message, isError) {
  el.textContent = message;
  el.className = 'status-msg' + (isError ? ' error' : '') + ' visible';
  setTimeout(() => {
    el.className = 'status-msg';
  }, 3000);
}
