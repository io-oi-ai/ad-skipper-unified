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

        // Reverting to a stricter filtering logic. The "Chinese+Number" heuristic was too broad.
        const adKeywords = ['广告', '恰饭', '赞助', '付费', '推广']; // High-confidence keywords
        const endTimeRegex = /[一二三四五六七八九十零\d]+\s*[:：分]\s*[一二三四五六七��九十零\d]+|结束|完毕|跳过|\d{3,}/; // Explicit timestamps

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
    prompt = 'You are a data extraction robot. Your only task is to analyze the following video subtitles and identify the start and end timestamps of any sponsored segments.\n' +
      'You MUST return a single, raw JSON object and nothing else. Do not include markdown, explanations, or any other text.\n' +
      'The JSON object must have "start" and "end" keys in seconds.\n' +
      'If no ad is found, return {"start": 0, "end": 0}.\n\n' +
      'Subtitles:\n---\n' +
      videoText.content + '\n---\n' +
      'JSON output only:';
  } else { // Danmaku
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

    log("YouTube ad detected. Taking action...");
    videoPlayer.muted = true;
    if (videoPlayer.playbackRate !== 16) videoPlayer.playbackRate = 16;

    const skipButton = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skipButton) {
      skipButton.click();
      log('YouTube skip button clicked.');
      return;
    }

    if (videoPlayer.duration) {
      videoPlayer.currentTime = videoPlayer.duration;
      log('Non-skippable YouTube ad force-skipped.');
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