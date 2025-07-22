// debug_skipper.js - FINAL VERSION

// --- Style Injection ---
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .ad-skipper-ui-container {
      position: absolute;
      bottom: 80px; /* Adjusted for better placement near progress bar */
      left: 20px;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      pointer-events: none;
    }
    .ad-skipper-ui-container.visible {
      opacity: 1;
      pointer-events: all;
    }
    .ad-skipper-prompt {
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 20px;
      border-radius: 20px;
      font-size: 14px;
      display: flex;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .ad-skipper-prompt-text {
      margin-right: 15px;
    }
    .ad-skipper-cancel-button {
      background: none;
      border: none;
      color: #ff5c5c;
      cursor: pointer;
      font-size: 14px;
      padding: 0;
    }
    .ad-skipper-cancel-button:hover {
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);
}
injectStyles();

// --- UI Manager ---
const AdSkipperUIManager = {
  uiContainer: null,
  skipTimeout: null,
  isCancelled: false,

  init(videoPlayer) {
    if (!this.uiContainer) {
      this.uiContainer = document.createElement('div');
      this.uiContainer.className = 'ad-skipper-ui-container';
      const playerContainer = videoPlayer.closest('.bpx-player-container');
      if (playerContainer) {
        playerContainer.style.position = 'relative';
        playerContainer.appendChild(this.uiContainer);
      } else {
        document.body.appendChild(this.uiContainer); // Fallback
      }
    }
  },

  showSkipPrompt(videoPlayer, adTimestamp) {
    this.isCancelled = false;
    this.init(videoPlayer);

    this.uiContainer.innerHTML = `
      <div class="ad-skipper-prompt">
        <span class="ad-skipper-prompt-text">即将为您跳过广告</span>
        <button class="ad-skipper-cancel-button">不跳过</button>
      </div>
    `;
    this.uiContainer.classList.add('visible');

    const cancelButton = this.uiContainer.querySelector('.ad-skipper-cancel-button');
    cancelButton.onclick = () => {
      this.isCancelled = true;
      this.hide();
      log("Ad skip cancelled by user.");
    };

    this.skipTimeout = setTimeout(() => {
      if (!this.isCancelled) {
        this.executeSkip(videoPlayer, adTimestamp);
      }
    }, 3000);
  },

  executeSkip(videoPlayer, adTimestamp) {
    log(`Skipping ad... setting time to ${adTimestamp.end}. Current time: ${videoPlayer.currentTime}`);
    videoPlayer.currentTime = adTimestamp.end;
    this.showSkippedMessage();
  },

  showSkippedMessage() {
    this.uiContainer.innerHTML = `
      <div class="ad-skipper-prompt">
        <span class="ad-skipper-prompt-text">已为您跳过广告</span>
      </div>
    `;
    this.uiContainer.classList.add('visible');
    setTimeout(() => this.hide(), 2000);
  },

  hide() {
    if (this.uiContainer) {
      this.uiContainer.classList.remove('visible');
    }
    if (this.skipTimeout) {
      clearTimeout(this.skipTimeout);
      this.skipTimeout = null;
    }
  }
};

function log(message) {
  console.log(`[Ad Skipper] ${message}`);
}

// --- Bilibili AI Ad Skipper ---
async function getBilibiliVideoText(bvid) {
  const FORCE_SUBTITLE_TEST = false; // Set to true to test subtitle fetching, false for normal operation.

  if (FORCE_SUBTITLE_TEST) {
    log("--- SUBTITLE TEST MODE ACTIVE ---");
    try {
      const pageListUrl = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`;
      const pageListResponse = await fetch(pageListUrl);
      const pageListData = await pageListResponse.json();
      if (pageListData.code !== 0 || !pageListData.data?.[0]?.cid) {
        throw new Error("Failed to get CID for subtitle test.");
      }
      const cid = pageListData.data[0].cid;

      const subtitleApiUrl = `https://api.bilibili.com/x/player/v2?cid=${cid}&bvid=${bvid}`;
      log(`Fetching subtitle list from: ${subtitleApiUrl}`);
      const response = await fetch(subtitleApiUrl);
      const data = await response.json();

      if (data.code === 0 && data.data.subtitle?.subtitles?.length > 0) {
          let subtitleUrl = data.data.subtitle.subtitles[0].subtitle_url;
          if (subtitleUrl.startsWith('http://')) {
              subtitleUrl = subtitleUrl.replace('http://', 'https://');
          }
          log(`Found subtitle URL: ${subtitleUrl}`);
          const subtitleResponse = await fetch(subtitleUrl);
          const subtitleData = await subtitleResponse.json();
          console.log("--- Successfully Fetched Subtitle JSON: ---");
          console.log(subtitleData); // Log the full subtitle JSON for inspection
          return null; // Stop further execution in test mode
      } else {
        log("No subtitles found for this video.");
      }
    } catch (error) {
        log(`Error during subtitle test: ${error}`);
    }
    return null; // Stop further execution in test mode
  }

  log("Attempting to extract Bilibili video text (subtitles/danmaku)...");

  // --- 1. Get CID ---
  let cid = window.__INITIAL_STATE__?.cidInfo?.cid || window.__INITIAL_STATE__?.videoData?.cid;

  if (cid) {
      log(`Found cid in __INITIAL_STATE__: ${cid}`);
  } else {
      log("cid not found in __INITIAL_STATE__, fetching from API...");
      try {
          const pageListUrl = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`;
          log(`Fetching pagelist from: ${pageListUrl}`);
          const response = await fetch(pageListUrl);
          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          log(`Pagelist API response: ${JSON.stringify(data)}`); // Log full response

          if (data.code === 0 && data.data && data.data.length > 0) {
              cid = data.data[0].cid;
              log(`Found cid via API: ${cid}`);
          } else {
              log(`Pagelist API returned no valid cid: ${data.message || 'Unknown error'}`);
          }
      } catch (error) {
          log(`Error fetching cid from API: ${error}`);
      }
  }

  if (!cid) {
      log("Failed to get video cid from any source.");
      return null;
  }

  // --- 2. Try to get Danmaku first ---
  try {
    const danmakuApiUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    log(`Fetching danmaku from: ${danmakuApiUrl}`);
    const response = await fetch(danmakuApiUrl);
    const xmlText = await response.text();
    
    const danmakuLines = Array.from(xmlText.matchAll(/<d p="(.*?)?">(.+?)<\/d>/g));
    const danmakuData = danmakuLines.map(match => {
        const pAttr = match[1].split(',');
        const time = parseFloat(pAttr[0]); // Emission time in seconds
        const content = match[2];
        return { time, content };
    });

    if (danmakuData.length > 0) {
        log(`Successfully extracted ${danmakuData.length} danmaku. Filtering for relevant comments...`);

        // Reverting to a stricter filtering logic. The "Chinese+Number" heuristic was too broad.
        const adKeywords = ['广告', '恰饭', '赞助', '付费', '推广']; // High-confidence keywords
        // Updated regex to include '.' as a valid time separator.
        const endTimeRegex = /[一二三四五六七八九十零\d]+\s*[:：分\.]\s*[一二三四五六七八九十零\d]+|结束|完毕|跳过|\d{3,}/; 

        const filteredDanmaku = danmakuData.filter(d => {
            // A danmaku is relevant if it EITHER contains a high-confidence keyword OR a timestamp format.
            const hasAdKeyword = adKeywords.some(keyword => d.content.includes(keyword));
            const hasTimestampFormat = endTimeRegex.test(d.content);
            return hasAdKeyword || hasTimestampFormat;
        });

        log(`Filtered danmaku from ${danmakuData.length} to ${filteredDanmaku.length}.`);

        if (filteredDanmaku.length > 0) {
            log("Successfully extracted and filtered content and time from Danmaku.");
            return { type: 'danmaku', data: filteredDanmaku }; // Return filtered data
        }
        log("No relevant danmaku found after filtering. Falling back to subtitles...");
    }
  } catch (error) {
      log(`Error fetching danmaku: ${error}. Falling back to subtitles...`);
  }

  // --- 3. Fallback to Subtitles (if danmaku fails or has no ad info) ---
  try {
    const subtitleApiUrl = `https://api.bilibili.com/x/player/v2?cid=${cid}&bvid=${bvid}`;
    log(`Fetching subtitle list from: ${subtitleApiUrl}`);
    const response = await fetch(subtitleApiUrl);
    const data = await response.json();

    if (data.code === 0 && data.data.subtitle?.subtitles?.length > 0) {
        let subtitleUrl = data.data.subtitle.subtitles[0].subtitle_url;
        if (subtitleUrl.startsWith('http://')) {
            subtitleUrl = subtitleUrl.replace('http://', 'https://');
        }
        log(`Found subtitle URL: ${subtitleUrl}`);
        const subtitleResponse = await fetch(subtitleUrl);
        const subtitleData = await subtitleResponse.json();
        const fullTranscript = subtitleData.body.map(line => line.content).join('\n');
        log("Successfully extracted transcript from subtitles.");
        return { type: 'subtitles', content: fullTranscript };
    }
  } catch (error) {
      log(`Error fetching subtitles: ${error}`);
  }
  
  log("Danmaku and subtitle extraction both failed.");
  return null;
}

async function callGeminiAPI(videoText, apiKey, apiEndpoint) {
  if (!apiKey || !apiEndpoint) {
    log("API Key or Endpoint is missing.");
    return null;
  }

  let prompt;
  if (videoText.type === 'subtitles') {
    prompt = 'You are a data extraction robot. Your only task is to analyze the following video subtitles and identify the start and end timestamps of any sponsored segments.\n' +
      'You MUST return a single, raw JSON object and nothing else. Do not include markdown, explanations, or any other text.\n' +
      'The JSON object must have "start" and "end" keys in seconds.\n' +
      'If no ad is found, return {"start": 0, "end": 0}.\n\n' +
      'Subtitles:\n---\n' +
      videoText.content + '\n---\n' +
      'JSON output only:';
  } else { // Danmaku
<<<<<<< HEAD
    prompt = 'You are an expert Bilibili comment analyst. Your goal is to analyze the provided danmaku comments to determine the start and end times of sponsored segments.\n\n' +
      '**Core Logic: Prioritize the "Key Comment"**\n' +
      'Your primary task is to find a "Key Comment" that defines the entire ad segment.\n\n' +
      '1.  **What is a "Key Comment"?**\n' +
      '    A comment like "我是四分三十五郎" or "谢谢你4分35狼" is a Key Comment. It contains everything needed.\n\n' +
      '2.  **How to Process a Key Comment:**\n' +
      '    - The `start` time is the `time` property of that specific comment.\n' +
      '    - The `end` time is the time parsed from the `content` of that same comment (e.g., "四分三十五" -> 275).\n\n' +
      '3.  **If multiple Key Comments exist,** synthesize them: use the `time` of the earliest one for the final `start`, and the parsed time from the one indicating the latest `end`.\n\n' +
      '4.  **Fallback Plan:**\n' +
      '    If, and only if, NO Key Comment is found, then you can analyze separate, non-key comments:\n' +
      '    - Find the earliest `time` from a comment with a keyword (e.g., "赞助").\n' +
      '    - Find the latest parsed time from a comment with a timestamp (e.g., "五分二十").\n\n' +
'**Output Format:**\n' +
      'Return ONLY a single, raw JSON object: `{"start": <seconds>, "end": <seconds>}`. Do not include any other text. If no ad is found, return `{"start": 0, "end": 0}`.\n\n' +
      'Danmaku Data:\n---\n' +
      JSON.stringify(videoText.data) + '\n---\n' +
      'JSON output only:';
  }

  try {
    log(`Filtered danmaku being sent to Gemini: ${JSON.stringify(videoText.data)}`);
    log(`Calling Gemini API for ${videoText.type}...`);
    const response = await fetch(`${apiEndpoint}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text;
    log(`API Response: ${resultText}`);
    
    // Clean the response to get pure JSON from markdown code block or directly from text
    let jsonString;
    const markdownMatch = resultText.match(/```json\n([\s\S]*?)\n```/);
    if (markdownMatch && markdownMatch[1]) {
        jsonString = markdownMatch[1].trim();
    } else {
        // Fallback: try to find the first { and last } to extract JSON
        const jsonRegex = /\{([\s\S]*?)\}/g; // More aggressive regex to find any JSON object
        let matches = [...resultText.matchAll(jsonRegex)];
        if (matches.length > 0) {
            // Take the last matched JSON object, as it's usually the one intended
            jsonString = matches[matches.length - 1][0].trim();
        }
    }

    if (jsonString && jsonString.startsWith('{')) {
        try {
            log(`Attempting to parse JSON: '${jsonString}'`); // Added for debugging
            const result = JSON.parse(jsonString);
            log(`Parsed JSON: ${JSON.stringify(result)}`);
            return result;
        } catch (e) {
            log(`JSON parse error: ${e}. Raw JSON string: '${jsonString}'`);
            return null;
        }
    }
    log(`Could not parse JSON from API response. Full response: '${resultText}'`);
    return null;

  } catch (error) {
    log(`Error calling Gemini API: ${error}`);
    return null;
  }
}

async function handleBilibiliVideo(videoPlayer) {
    // Get the unique video ID (bvid)
    let bvid = window.__INITIAL_STATE__?.bvid || window.location.href.match(/BV[a-zA-Z0-9_]{10}/)?.[0];

    if (!bvid) {
        log("Could not get bvid. AI skipper cannot run.");
        return;
    }

    // If the skipper is already attached and running for the *current* video, do nothing.
    if (videoPlayer.dataset.attachedBvid === bvid) {
        return;
    }

    // --- New video detected ---
    log(`New video detected (BVID: ${bvid}). Initializing skipper.`);
    videoPlayer.dataset.attachedBvid = bvid; // Mark the player with the new BVID
    delete videoPlayer.dataset.skipIntervalAttached; // Reset the interval flag for the new video

    // 1. Check local cache first
    const cacheKey = `bvid-${bvid}`;
    chrome.storage.local.get([cacheKey], async (result) => {
        if (result[cacheKey]) {
            log(`Cache hit for ${bvid}. Using cached timestamp.`);
            const adTimestamp = result[cacheKey];
            if (adTimestamp && adTimestamp.start > 0) {
                attachSkipListener(videoPlayer, adTimestamp);
            }
        } else {
            log(`Cache miss for ${bvid}. Proceeding with API call.`);
            const videoText = await getBilibiliVideoText(bvid);
            if (!videoText) {
                log("Could not get video text, AI skipper will not run.");
                return;
            }

            const apiKey = "AIzaSyASbNd_JefjCz8MDxixBLnI-IWWZssEqLk";
            const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
            const adTimestamp = await callGeminiAPI(videoText, apiKey, apiEndpoint);

            if (adTimestamp) {
                if (adTimestamp.start > 0 && adTimestamp.end === 0) {
                    const DEFAULT_AD_DURATION = 60;
                    adTimestamp.end = adTimestamp.start + DEFAULT_AD_DURATION;
                    log(`Inferred ad end time: ${adTimestamp.end}s (default duration).`);
                }

                chrome.storage.local.set({ [cacheKey]: adTimestamp }, () => {
                    log(`Saved timestamp to cache for ${bvid}.`);
                });
                if (adTimestamp.start > 0) {
                    attachSkipListener(videoPlayer, adTimestamp);
                }
            } else {
                log("No ad detected by AI.");
            }
        }
    });
}

function attachSkipListener(videoPlayer, adTimestamp) {
    log(`Attaching skip listener for ad from ${adTimestamp.start}s to ${adTimestamp.end}s.`);

    // Clean up any previous listeners on this element to be safe
    if (videoPlayer._adSkipTimeUpdateHandler) {
        videoPlayer.removeEventListener('timeupdate', videoPlayer._adSkipTimeUpdateHandler);
    }

    // Handle case where listener attaches mid-ad
    if (videoPlayer.currentTime >= adTimestamp.start && videoPlayer.currentTime < adTimestamp.end) {
        log("Listener attached mid-ad. Skipping immediately.");
        AdSkipperUIManager.init(videoPlayer);
        AdSkipperUIManager.executeSkip(videoPlayer, adTimestamp);
        return; // Ad is skipped, no need to attach a listener.
    }

    let promptShown = false;

    const timeUpdateHandler = () => {
        // If the element is gone, clean up and stop.
        if (!document.body.contains(videoPlayer)) {
            videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
            AdSkipperUIManager.hide();
            return;
        }

        const currentTime = videoPlayer.currentTime;
        const promptTime = adTimestamp.start - 4;

        // --- Condition 1: Show the prompt ---
        if (currentTime >= promptTime && currentTime < adTimestamp.start) {
            if (!promptShown) {
                promptShown = true;
                AdSkipperUIManager.showSkipPrompt(videoPlayer, adTimestamp);
            }
        } 
        // --- Condition 2: Ad is playing, but prompt was missed (API lag, etc.) ---
        else if (currentTime >= adTimestamp.start && currentTime < adTimestamp.end) {
            // If the prompt was never shown (and not cancelled), skip immediately.
            if (!promptShown && !AdSkipperUIManager.isCancelled) {
                log("Ad already started, prompt missed. Skipping immediately.");
                AdSkipperUIManager.init(videoPlayer);
                AdSkipperUIManager.executeSkip(videoPlayer, adTimestamp);
                // The skip is done, so we can remove the listener.
                videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
            }
        }
        // --- Condition 3: We are past the ad segment ---
        else if (currentTime >= adTimestamp.end) {
            // Ad is over, clean everything up.
            AdSkipperUIManager.hide();
            videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        }
    };

    videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
    videoPlayer._adSkipTimeUpdateHandler = timeUpdateHandler; // Store a reference for future cleanup
}


// --- Main Ad Check Logic ---
function handleAdCheck() {
  // --- YouTube Logic ---
  const isYouTubeAdPlaying = document.querySelector('.ad-showing');
  if (isYouTubeAdPlaying) {
    const videoPlayer = document.querySelector('.html5-main-video');
    if (!videoPlayer) return;

    // Only log "detected" once per ad instance
    if (!videoPlayer.dataset.adSkipperYouTubeAdDetected) {
        log("YouTube ad detected. Attempting to skip...");
        videoPlayer.dataset.adSkipperYouTubeAdDetected = 'true';
    }

    videoPlayer.muted = true;
    if (videoPlayer.playbackRate !== 16) videoPlayer.playbackRate = 16;

    const skipButton = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skipButton) {
      skipButton.click();
      log('YouTube: Skip button clicked.');
      // Once clicked, the ad might disappear, so we can reset the flag
      delete videoPlayer.dataset.adSkipperYouTubeAdDetected;
      return; // Ad should be gone, no need for further actions
    }

    // If no skip button, it's likely a non-skippable ad
    if (!videoPlayer.dataset.adSkipperYouTubeNonSkippableHandled) {
        log('YouTube: Non-skippable ad detected. Force skipping...');
        videoPlayer.dataset.adSkipperYouTubeNonSkippableHandled = 'true';
    }

    if (videoPlayer.duration) {
      videoPlayer.currentTime = videoPlayer.duration;
      log('YouTube: Force-skipped by setting currentTime to duration.');
    } else {
      videoPlayer.currentTime = 99999;
      log('YouTube: Force-skipped by setting currentTime to a large number.');
    }

    // Also try to remove the ad container itself
    if (isYouTubeAdPlaying.parentNode) {
        isYouTubeAdPlaying.parentNode.removeChild(isYouTubeAdPlaying);
        log('YouTube: Ad container removed from DOM.');
        // Once removed, we can reset the flags
        delete videoPlayer.dataset.adSkipperYouTubeAdDetected;
        delete videoPlayer.dataset.adSkipperYouTubeNonSkippableHandled;
    }
  } else {
    // If no ad is showing, ensure our flags are reset for the next ad
    const videoPlayer = document.querySelector('.html5-main-video');
    if (videoPlayer) {
        delete videoPlayer.dataset.adSkipperYouTubeAdDetected;
        delete videoPlayer.dataset.adSkipperYouTubeNonSkippableHandled;
    }
  }
  
  // --- Bilibili Logic ---
  const bilibiliVideoPlayer = document.querySelector('.bpx-player-video-area video');
  if (bilibiliVideoPlayer) {
      handleBilibiliVideo(bilibiliVideoPlayer);
  }

  // --- Universal Ad Overlay Hiding ---
  const adOverlay = document.querySelector('.ytp-ad-player-overlay-instream-info, .video-ads');
  if (adOverlay) {
    adOverlay.style.display = 'none';
    log('Ad overlay hidden.');
  }
}

// Use a MutationObserver for efficient detection.
const observer = new MutationObserver(() => {
  handleAdCheck();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

log("Ad Skipper is active and observing.");