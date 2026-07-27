// content.js
//
// Runs in every frame of every page (see manifest.json). Finds the
// main video on the page, optionally scans it for black bars, and
// crops or stretches it to fill its own box. Everything reacts to
// chrome.storage, so the popup never has to talk to this script
// directly, it only ever writes settings and this script picks them
// up through the storage change listener below.
//
// Shared constants (defaults, the fixed-ratio list, the alignment list)
// live in shared-constants.js, loaded before this file, see manifest.json.

(function () {
  'use strict';

  // A short list of video elements we can identify with confidence by a
  // fixed CSS selector, checked before falling back to "biggest video on
  // the page". Jellyfin's own web client (GPL-2.0, verified against its
  // public source) tags its player with this class, so it is safe to rely
  // on. The YouTube selector below is a best-effort addition based on a
  // long-standing, widely-referenced class name in YouTube's player, not
  // something verified against a public source the way Jellyfin's is,
  // YouTube's own markup isn't public and could change without notice.
  // Either way this list only ever narrows the choice, the largest-
  // visible-video fallback below still covers YouTube (or anywhere else)
  // if a selector here ever stops matching.
  const KNOWN_SELECTORS = [
    'video.htmlvideoplayer',
    '.html5-video-player video.html5-main-video'
  ];

  const SCAN = {
    everyMs: 900,
    w: 40,
    h: 24,
    darkCutoff: 24,      // 0-255 average brightness under this counts as "bar"
    minContentLuma: 45,  // the middle of the frame must be at least this bright,
                          // otherwise this is a full-frame fade/transition, not
                          // real bars, see sampleBars()
    minBarPct: 0.03,     // ignore anything thinner than 3% of the frame
    maxBarPct: 0.28,     // refuse to trust a "bar" thicker than 28%
    confirmSamples: 2    // require this many matching readings before applying
  };

  let settings = { ...LetaGoShared.DEFAULTS };
  let video = null;
  let scanTimer = null;
  let pendingBars = null;
  let pendingCount = 0;
  let lastDetectedBars = null;          // last CONFIRMED auto-detect reading for the CURRENT video; survives a settings-only change, see applyCurrentCrop()
  let lastAppliedStyleSignature = null; // the transform + transformOrigin string this script itself last wrote, used by the watchdog below to tell "someone else changed this" apart from "that's just our own write"
  let styleWatchdog = null;
  let mutationTimer = null;

  const canvas = document.createElement('canvas');
  canvas.width = SCAN.w;
  canvas.height = SCAN.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function targetARFor(mode) {
    const found = LetaGoShared.FIXED_MODES.find((m) => m.value === mode);
    return found ? found.ratio : null;
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get({ [LetaGoShared.GLOBAL_KEY]: LetaGoShared.DEFAULTS });
    settings = { ...LetaGoShared.DEFAULTS, ...data[LetaGoShared.GLOBAL_KEY] };
  }

  function updateObserverState() {
    // Only pay the MutationObserver's cost (it fires on every DOM change
    // in this frame, subtree included) while the extension is actually
    // enabled for this page. observe() is safe to call again with the
    // same target/options if it's already observing.
    if (settings.enabled) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      observer.disconnect();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[LetaGoShared.GLOBAL_KEY]) {
      loadSettings().then(() => {
        updateObserverState();
        refresh();
      });
    }
  });

  function isUsableRect(r) {
    return !!r && r.width > 120 && r.height > 80;
  }

  function isUsable(el) {
    if (!el || el.tagName !== 'VIDEO') return false;
    return isUsableRect(el.getBoundingClientRect());
  }

  function pickVideo() {
    for (const sel of KNOWN_SELECTORS) {
      const el = document.querySelector(sel);
      if (isUsable(el)) return el;
    }
    const vids = document.querySelectorAll('video');
    let best = null;
    let bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      if (!isUsableRect(r)) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  function watchVideo(v) {
    if (v.dataset.letagoWatched === '1') return;
    v.dataset.letagoWatched = '1';

    v.addEventListener('loadedmetadata', refresh);
    v.addEventListener('emptied', () => {
      // The underlying media resource is going away (a new source is
      // likely about to load into the same element), so any bars we
      // detected for the old content no longer mean anything.
      if (v === video) {
        resetVideo(v);
        lastDetectedBars = null;
      }
    });

    // Auto-detect only needs to poll while something is actually playing.
    // Stopping the interval on pause (rather than leaving it running and
    // having tick() no-op every time) saves CPU on a paused page, and
    // restarting it on play picks scanning back up without waiting for
    // the next settings change or DOM mutation to trigger a refresh().
    v.addEventListener('play', () => {
      if (v !== video || !settings.enabled || settings.mode !== 'auto') return;
      startScan();
    });
    v.addEventListener('pause', () => {
      if (v === video) stopScan();
    });

    attachStyleWatchdog(v);
  }

  function ensureWrap(v) {
    const parent = v.parentElement;
    if (!parent) return null;
    if (parent.classList && parent.classList.contains('letago-wrap')) return parent;
    const wrap = document.createElement('div');
    wrap.className = 'letago-wrap';
    parent.insertBefore(wrap, v);
    wrap.appendChild(v);
    return wrap;
  }

  function resetVideo(v) {
    if (!v) return;
    v.style.transform = '';
    v.style.transformOrigin = '';
    lastAppliedStyleSignature = '|';
  }

  // Watches the video element's own `style` attribute so a crop this
  // extension applied can be reasserted if something else changes it.
  // Several sites re-run their own sizing logic in response to events
  // like a fullscreen toggle or a quality switch, which can overwrite the
  // inline transform this extension set without the page ever removing
  // our wrapper or swapping the element itself, so nothing else here
  // would otherwise notice. The explicit fullscreenchange listener
  // further down is a faster, more deterministic backstop for that one
  // specific, common trigger; both end up calling applyCurrentCrop().
  function attachStyleWatchdog(v) {
    if (styleWatchdog) styleWatchdog.disconnect();
    styleWatchdog = new MutationObserver(() => {
      if (!settings.enabled || settings.mode === 'off') return;
      const current = `${v.style.transform}|${v.style.transformOrigin}`;
      if (current === lastAppliedStyleSignature) return; // matches what we last set, nothing to do
      applyCurrentCrop();
    });
    styleWatchdog.observe(v, { attributes: true, attributeFilter: ['style'] });
  }

  // Single mechanism used by both auto-detect and the fixed-ratio
  // modes: scale the video around the center of the region we want
  // to keep, then let the wrapper's overflow:hidden clip the excess.
  // Expressed as percentages, so it keeps working across resizes
  // without any recalculation.
  function applyBars(v, bars) {
    const wrap = ensureWrap(v);
    if (!wrap) return;

    const keepW = 1 - bars.left - bars.right;
    const keepH = 1 - bars.top - bars.bottom;
    if (keepW < 0.35 || keepH < 0.35) return; // refuse an implausible crop

    const zoom = (settings.zoom || 100) / 100;
    const originX = (bars.left + keepW / 2) * 100;
    const originY = (bars.top + keepH / 2) * 100;
    const transformOrigin = `${originX}% ${originY}%`;
    const transform = settings.stretch
      ? `scale(${(1 / keepW) * zoom}, ${(1 / keepH) * zoom})`
      : `scale(${Math.max(1 / keepW, 1 / keepH) * zoom})`;

    v.style.transformOrigin = transformOrigin;
    v.style.transform = transform;
    lastAppliedStyleSignature = `${transform}|${transformOrigin}`;
  }

  // `alignment` decides how the trimmed fraction is split between the two
  // edges being cropped: evenly ('center', the original behavior), or
  // entirely on one edge ('start'/'end'), keeping the opposite edge
  // untouched. Only fixed-ratio modes use this. Auto-detect crops bars
  // that are already physically present in the source, so there is no
  // split to choose, whatever the detected edges are is what gets cut.
  function computeManualBars(v, targetAR, alignment) {
    const vw = v.videoWidth || v.clientWidth;
    const vh = v.videoHeight || v.clientHeight;
    if (!vw || !vh) return null;
    const sourceAR = vw / vh;

    if (Math.abs(sourceAR - targetAR) < 0.01) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }

    const split = (total) => {
      if (alignment === 'start') return [0, total];
      if (alignment === 'end') return [total, 0];
      return [total / 2, total / 2];
    };

    if (sourceAR > targetAR) {
      const [left, right] = split(1 - targetAR / sourceAR);
      return { top: 0, bottom: 0, left, right };
    }
    const [top, bottom] = split(1 - sourceAR / targetAR);
    return { top, bottom, left: 0, right: 0 };
  }

  function sampleBars(v) {
    if (v.readyState < 2) return null;
    try {
      ctx.drawImage(v, 0, 0, SCAN.w, SCAN.h);
    } catch (e) {
      return null; // cross-origin canvas taint or similar, give up quietly
    }
    let data;
    try {
      data = ctx.getImageData(0, 0, SCAN.w, SCAN.h).data;
    } catch (e) {
      return null;
    }

    const luma = (x, y) => {
      const i = (y * SCAN.w + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const rowIsDark = (y) => {
      let sum = 0;
      for (let x = 0; x < SCAN.w; x++) sum += luma(x, y);
      return sum / SCAN.w < SCAN.darkCutoff;
    };
    const colIsDark = (x) => {
      let sum = 0;
      for (let y = 0; y < SCAN.h; y++) sum += luma(x, y);
      return sum / SCAN.h < SCAN.darkCutoff;
    };

    // Sanity check before trusting any edge reading at all: is there
    // real picture in the middle of the frame? A full-frame fade to
    // black, a loading spinner on a black background, or the gap
    // between two videos all look like "bars on every edge" if we
    // only ever look at the edges. Requiring the center to be
    // meaningfully brighter than the dark cutoff avoids treating those
    // moments as a black-bar frame and clamping to a maximal crop.
    const cx0 = Math.floor(SCAN.w * 0.25);
    const cx1 = Math.ceil(SCAN.w * 0.75);
    const cy0 = Math.floor(SCAN.h * 0.25);
    const cy1 = Math.ceil(SCAN.h * 0.75);
    let centerSum = 0;
    let centerCount = 0;
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        centerSum += luma(x, y);
        centerCount++;
      }
    }
    const centerLuma = centerCount ? centerSum / centerCount : 0;
    if (centerLuma < SCAN.minContentLuma) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }

    // maxRow/maxCol are the grid-cell cap expressed as a float; flooring
    // it before the loop keeps the actual result at or under
    // SCAN.maxBarPct instead of one grid step over it.
    const maxRowSteps = Math.floor(SCAN.h * SCAN.maxBarPct);
    const maxColSteps = Math.floor(SCAN.w * SCAN.maxBarPct);

    let top = 0, bottom = 0, left = 0, right = 0;
    while (top < maxRowSteps && rowIsDark(top)) top++;
    while (bottom < maxRowSteps && rowIsDark(SCAN.h - 1 - bottom)) bottom++;
    while (left < maxColSteps && colIsDark(left)) left++;
    while (right < maxColSteps && colIsDark(SCAN.w - 1 - right)) right++;

    const bars = {
      top: top / SCAN.h,
      bottom: bottom / SCAN.h,
      left: left / SCAN.w,
      right: right / SCAN.w
    };
    if (bars.top < SCAN.minBarPct) bars.top = 0;
    if (bars.bottom < SCAN.minBarPct) bars.bottom = 0;
    if (bars.left < SCAN.minBarPct) bars.left = 0;
    if (bars.right < SCAN.minBarPct) bars.right = 0;
    return bars;
  }

  function barsMatch(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.top - b.top) < 0.01 &&
      Math.abs(a.bottom - b.bottom) < 0.01 &&
      Math.abs(a.left - b.left) < 0.01 &&
      Math.abs(a.right - b.right) < 0.01;
  }

  // The single place that decides what should be on screen right now,
  // given the CURRENT settings and whatever is already known about the
  // video (lastDetectedBars, for auto mode). Called after every settings
  // change and after every newly confirmed auto-detect reading, so
  // neither input can go stale relative to the other: a settings-only
  // change (say, zoom) must still produce a new result even though the
  // detected bars themselves have not changed. This is also what the
  // style watchdog and the fullscreenchange listener call to reassert a
  // crop that something else on the page disturbed.
  function applyCurrentCrop() {
    if (!video || !settings.enabled) return;

    if (settings.mode === 'off') {
      resetVideo(video);
      return;
    }

    if (settings.mode === 'auto') {
      if (lastDetectedBars) applyBars(video, lastDetectedBars);
      return; // not known yet, the scan loop below will call this again once it is
    }

    const targetAR = targetARFor(settings.mode);
    const bars = targetAR ? computeManualBars(video, targetAR, settings.alignment) : null;
    if (bars) applyBars(video, bars);
  }

  function tick() {
    if (!video || video.paused) return;
    const bars = sampleBars(video);
    if (!bars) return;
    if (barsMatch(bars, lastDetectedBars)) return;

    if (barsMatch(bars, pendingBars)) {
      pendingCount++;
    } else {
      pendingBars = bars;
      pendingCount = 1;
    }

    if (pendingCount >= SCAN.confirmSamples) {
      lastDetectedBars = pendingBars;
      applyCurrentCrop();
    }
  }

  function startScan() {
    stopScan();
    if (!video || video.paused) return; // the 'play' listener in watchVideo() restarts this once playback begins
    pendingBars = null;
    pendingCount = 0;
    scanTimer = setInterval(tick, SCAN.everyMs);
    tick();
  }

  function stopScan() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = null;
  }

  function refresh() {
    if (!settings.enabled) {
      if (video) resetVideo(video);
      stopScan();
      return;
    }

    const v = pickVideo();
    if (!v) {
      stopScan();
      if (video) resetVideo(video);
      video = null;
      lastDetectedBars = null;
      return;
    }

    const isNewVideo = v !== video;
    video = v;
    watchVideo(video);

    // Only a genuinely new video element invalidates the detected-bars
    // cache. A settings change alone must not: reapplying with new
    // settings against still-valid detected bars is handled by
    // applyCurrentCrop() below, not by throwing the bars away here.
    if (isNewVideo) {
      lastDetectedBars = null;
    }

    if (settings.mode === 'off') {
      resetVideo(video);
      stopScan();
      return;
    }

    if (settings.mode === 'auto') {
      applyCurrentCrop(); // instant feedback if bars are already known, e.g. after a zoom change
      startScan();        // keep watching for new bars, or confirm the first ones
      return;
    }

    stopScan();
    applyCurrentCrop();
  }

  // Reapply shortly after a fullscreen transition. Many players resize or
  // re-layout the video element in response to entering or leaving
  // fullscreen, which can overwrite the inline transform this extension
  // applies. The double rAF gives the page's own fullscreenchange
  // handling a chance to run first, so this reasserts on top of it rather
  // than racing it. The style watchdog above is the general-purpose
  // backstop for cases where the timing does not line up.
  function handleFullscreenChange() {
    if (!settings.enabled || settings.mode === 'off') return;
    requestAnimationFrame(() => requestAnimationFrame(applyCurrentCrop));
  }

  document.addEventListener('fullscreenchange', handleFullscreenChange, true);

  // Catches SPA navigation and players that mount their <video> late.
  // Debounced because busy pages mutate the DOM constantly. Gated on
  // settings.enabled both before and after the debounce, since the
  // pickVideo() scan below forces a layout read for every candidate
  // video on the page and there is no reason to pay for that while the
  // extension is off for this page. Also fires refresh() when a
  // previously-found video disappears entirely (v becomes null), so
  // state gets torn down instead of quietly going stale.
  const observer = new MutationObserver(() => {
    if (!settings.enabled) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      if (!settings.enabled) return;
      const v = pickVideo();
      if (v !== video) refresh();
    }, 400);
  });

  (async function init() {
    await loadSettings();
    updateObserverState();
    refresh();
  })();
})();
