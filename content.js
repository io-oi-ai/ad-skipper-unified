// content.js
// Adapted from the logic in https://github.com/squgeim/yt-ad-autoskipper

let isEnabled = true;

// --- Utility Functions ---
function log(message) {
  console.log(`[Ad Skipper] ${message}`);
}

// --- Main State Management ---
chrome.storage.sync.get('enabled', (data) => {
  isEnabled = data.enabled !== false;
  log(`Extension initialized. State: ${isEnabled ? 'Active' : 'Inactive'}`);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    isEnabled = changes.enabled.newValue;
    log(`State changed to: ${isEnabled ? 'Active' : 'Inactive'}`);
  }
});

// --- Core Ad Skipping Logic using MutationObserver ---

const observer = new MutationObserver((mutations) => {
  if (!isEnabled) {
    return;
  }

  mutations.forEach((mutation) => {
    // Check if the ad container or skip button has been added to the page
    if (mutation.addedNodes.length) {
      // Speed up the video if an ad is showing
      const videoPlayer = document.querySelector('.html5-main-video');
      if (videoPlayer && document.querySelector('.ad-showing')) {
        videoPlayer.muted = true;
        videoPlayer.playbackRate = 16;
      }

      // Attempt to click the skip button
      const skipButton = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skipButton) {
        skipButton.click();
        log('Skip button clicked.');
      }

      // Hide ad overlays
      const adOverlay = document.querySelector('.ytp-ad-player-overlay-instream-info, .video-ads');
      if (adOverlay) {
        adOverlay.style.display = 'none';
        log('Ad overlay hidden.');
      }
    }
  });
});

// --- Initialization ---

// Start observing the entire document for changes.
// This is more efficient than setInterval as it only runs when the DOM changes.
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

log("Ad observer initialized and watching for changes.");