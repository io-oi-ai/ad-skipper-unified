// debug_skipper.js - FINAL VERSION

function log(message) {
  console.log(`[Ad Skipper] ${message}`);
}

// --- Bilibili AI Ad Skipper ---
async function getBilibiliVideoText(bvid) {
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

        const adKeywords = ['广告', '高能', '恰饭', '赞助', '付费', '推广', '跳', '郎', '了'];
        // Regex to find timestamps like 3:07, 3分07, or end markers
        const endTimeRegex = /[一二三四五六七八九十零\d]+\s*[:：分]\s*[一二三四五六七八九十零\d]+|结束|完毕|跳过|\d{3,}/;

        const filteredDanmaku = danmakuData.filter(d => {
            const hasKeyword = adKeywords.some(keyword => d.content.includes(keyword));
            const hasEndTime = endTimeRegex.test(d.content);
            return hasKeyword || hasEndTime;
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

  // --- 3. Fallback to Subtitles ---
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
    prompt = `
      You are an expert at detecting advertisements in video transcripts.
      Analyze the following subtitles and identify the start and end timestamps of any sponsored segments.
      Return your answer as a single, clean JSON object with "start" and "end" keys in seconds.
      For example: {"start": 123, "end": 184}
      If no ad is found, return {"start": 0, "end": 0}.

      Subtitles:
      ---
      ${videoText.content}
      ---
    `;
  } else { // Danmaku
    prompt = `
      You are an expert at analyzing Bilibili viewer comments (danmaku) to identify sponsored segments in a video.
      You will be provided with a list of danmaku, each with an emission time (`time`) and its text (`content`).
      The format is: [{"time": <seconds>, "content": "<comment>"}, ...]

      Your task is to identify the start and end times of any sponsored segments based on these danmaku.

      Here is how to determine the timestamps:
      1.  **Start Time**: The ad starts at the `time` (emission time) of a danmaku that first indicates a sponsored segment. Indicators can be keywords like "广告", "恰饭", "高能", or a user pointing out an ad end time.
      2.  **End Time**: The ad ends at the timestamp mentioned *within the `content`* of a danmaku. You must parse this timestamp.

      **Crucial Logic:**
      - A danmaku like `{"time": 172, "content": "我是3分27秒郎"}` means the ad **starts at 172 seconds** and **ends at 207 seconds** (3*60 + 27).
      - The `time` property is the ad's START. The time mentioned in the `content` is the ad's END.
      - If you find multiple ad-related danmaku, use the `time` of the earliest one for the "start" and the latest parsed timestamp from any of them for the "end".
      - If a danmaku only indicates a start (e.g., `{"time": 170, "content": "前方高能"}`) and no other danmaku provides an end time, return the start time and set the end time to 0.
      - You must understand Chinese internet slang, puns, and shorthand for timestamps. For example, "414" means 4:14, and "郎" (láng) is a pun for "了" (le), indicating completion.

      Return your answer as a single, clean JSON object with "start" and "end" keys in seconds.
      If no ad is found, return `{"start": 0, "end": 0}`.

      Example Analysis:
      Input: `[{"time": 172.2, "content": "我是三分二十七郎"}, {"time": 170.1, "content": "前方高能"}]`
      - The earliest ad indicator is at 170.1s. So, `start` is 170.
      - A danmaku provides an end time of 3m 27s = 207s. So, `end` is 207.
      - Result: `{"start": 170, "end": 207}`

      Danmaku Comments:
      ---
      ${JSON.stringify(videoText.data)}
      ---
    `;
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
    if (videoPlayer.dataset.aiSkipperAttached) return;
    videoPlayer.dataset.aiSkipperAttached = 'true';
    log("AI Skipper attached to new Bilibili video.");

    let bvid = window.__INITIAL_STATE__?.bvid;

    if (!bvid) {
        log("bvid not found in __INITIAL_STATE__, trying to parse from URL.");
        const match = window.location.href.match(/BV[a-zA-Z0-9_]{10}/);
        if (match) {
            bvid = match[0];
            log(`Found bvid in URL: ${bvid}`);
        }
    }

    if (!bvid) {
        log("Could not get bvid from any source. AI skipper cannot run.");
        return; // Cannot proceed without bvid
    }

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
            // 2. Get Video Text (Subtitles or Danmaku)
            const videoText = await getBilibiliVideoText(bvid);
            if (!videoText) {
                log("Could not get video text, AI skipper will not run.");
                return;
            }

            // 3. Call Gemini API
            const apiKey = "AIzaSyASbNd_JefjCz8MDxixBLnI-IWWZssEqLk";
            const apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"; // Use gemini-2.5-flash model
            const adTimestamp = await callGeminiAPI(videoText, apiKey, apiEndpoint);

            // 4. Process and cache the result
            if (adTimestamp) {
                // If only start time is provided, set a default end time
                if (adTimestamp.start > 0 && adTimestamp.end === 0) {
                    const DEFAULT_AD_DURATION = 60; // seconds
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
    log(`Attaching skip listener for ad from ${adTimestamp.start}s to ${adTimestamp.end}s. Ad details: ${JSON.stringify(adTimestamp)}`);
    
    // To avoid attaching multiple intervals to the same player
    if (videoPlayer.dataset.skipIntervalAttached) return;
    videoPlayer.dataset.skipIntervalAttached = 'true';

    const intervalId = setInterval(() => {
        // If the video element is no longer in the DOM, stop the interval
        if (!document.body.contains(videoPlayer)) {
            log("Video player removed from DOM. Clearing skip interval.");
            clearInterval(intervalId);
            return;
        }

        if (videoPlayer.currentTime >= adTimestamp.start && videoPlayer.currentTime < adTimestamp.end) {
            log(`Skipping ad... setting time to ${adTimestamp.end}. Current time: ${videoPlayer.currentTime}`);
            videoPlayer.currentTime = adTimestamp.end;
        }
    }, 250); // Check every 250ms
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