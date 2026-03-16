const statusAmazon = document.getElementById('status-amazon');
const statusNotAmazon = document.getElementById('status-not-amazon');
const statusNoKey = document.getElementById('status-no-key');

document.getElementById('open-settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Check if we're on an Amazon product page and if the API key is set
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const isAmazon = tab && /https:\/\/www\.amazon\.[a-z.]+\/.*\/dp\/[A-Z0-9]{10}/.test(tab.url);

  chrome.storage.sync.get({ apiKey: '' }, ({ apiKey }) => {
    if (!apiKey) {
      statusNoKey.classList.remove('ara-hidden');
    } else if (isAmazon) {
      statusAmazon.classList.remove('ara-hidden');
    } else {
      statusNotAmazon.classList.remove('ara-hidden');
    }
  });
});
