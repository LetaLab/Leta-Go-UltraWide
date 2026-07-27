# Leta Go UltraWide

<p align="left">  
<!-- Replace with your own uploaded OG/mascot image URL, same as the other LetaLab READMEs -->
<img src="REPLACE-WITH-OG-IMAGE-URL" alt="OG" width="15%">
</p>

---

<p align="center">
  <em>Hi, I'm Leta - the mascot of all projects under the LetaLab umbrella!</em><br><br>
  <em>Andrzej brought me to life using Inkscape! I am related to Tux!</em><br>
</p>

<p align="center">
<!-- Replace with your own uploaded icon-512 image URL -->
  <img src="REPLACE-WITH-ICON-512-URL" alt="icon-512" width="220">
</p>

---

**Crop, zoom, or stretch away the black bars around a playing video - automatically.**

Streaming sites and self-hosted media players don't always know your screen's real shape, so a video that doesn't match it shows up letterboxed or pillarboxed, with black bars eating into the picture. Leta Go UltraWide watches the playing video, works out where the bars are, and scales the picture to fill its box. Prefer to force a specific ratio instead of auto detection, say for a movie you know is mastered at 2.39:1? Pick it from the popup and it's applied instantly, no detection needed.

"Leta Go UltraWide" is a small, single-purpose extension for Chrome, Edge, Brave, and other Chromium-based browsers, and it's part of the LetaLab family of projects - you can find the rest of them at [https://LetaLab.eu](https://letalab.eu).

Website is created by me and I do everything that is in my limited power to make it [safe and private](https://www.ssllabs.com/ssltest/analyze.html?d=letalab.eu&hideResults=on&latest).

| SSLLabs Server testing results |
|---|
| <!-- Replace with your own uploaded SSLLabs screenshot URL --> |

![Manifest](https://img.shields.io/badge/Manifest-V3-blue)
![Browsers](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Chromium-supported-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Table of contents

- [Get the extension](#get-the-extension)
- [Screenshots](#screenshots)
- [Features](#features)
- [How it works](#how-it-works)
- [Permissions](#permissions)
- [Privacy and security](#privacy-and-security)
- [Known issues and support](#known-issues-and-support)
- [Directory structure](#directory-structure)
- [License](#license)
- [Credits](#credits)

## Get the extension

The easiest way to install Leta Go UltraWide is straight from your browser's official store:

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-blue)](ADD-THIS-LATER)
[![Edge Add-ons](https://img.shields.io/badge/Edge%20Addons-Install-blue)](ADD-THIS-LATER)

Brave and other Chromium-based browsers can use the Chrome Web Store link above too.

## Screenshots

<!-- Replace the placeholder links below with your own uploaded screenshot URLs -->

| Popup | Auto detect in action |
|---|---|
| <a href="REPLACE-WITH-POPUP-SCREENSHOT-URL"><img width="100%" alt="Popup" src="REPLACE-WITH-POPUP-SCREENSHOT-URL" /></a> | <a href="REPLACE-WITH-CROP-SCREENSHOT-URL"><img width="100%" alt="Auto detect in action" src="REPLACE-WITH-CROP-SCREENSHOT-URL" /></a> |

## Features

- Auto detect mode finds black bars by sampling the playing frame, no per-site setup needed
- Six fixed ratios when you'd rather force one than wait on detection: 4:3, 16:10, 16:9, 2:1 (the ratio Netflix and Apple TV+ use for a lot of their own originals), 21:9, and 2.39:1 (Cinemascope, the ratio most modern theatrical releases are mastered in)
- Adjustable zoom from 80% to 160%, applied on top of whichever crop is active
- Stretch instead of crop, for the rare case you'd rather fill the frame than lose any of it
- Crop alignment for fixed ratios: centered by default, or biased to keep one edge (top/left or bottom/right) untouched instead of trimming evenly from both sides
- A simple ON/OFF toggle in the popup pauses the extension everywhere without uninstalling anything
- Known-selector support for players that need it (currently Jellyfin's own web client, plus a best-effort selector for YouTube's own player), with a largest-visible-video fallback for every other site
- Zero configuration beyond the popup - no accounts, no onboarding, no setup wizard
- A small link to letalab.eu at the bottom of the popup - just a plain link that opens in a new tab, nothing tracking it

## How it works

Leta Go UltraWide runs a content script on every page (it has to, there's no way to know in advance which site or frame has a video). It looks for the video in two steps: a short list of known player selectors first (Jellyfin's `video.htmlvideoplayer`, taken from Jellyfin's public GPL-2.0 source, and a best-effort selector for YouTube's own player, whose internal markup isn't public so this one is kept as a hint rather than something relied on), then the largest visible `<video>` element as a fallback for everywhere else.

In Auto detect mode, it samples a small offscreen canvas from the playing frame roughly every 900ms and averages brightness along each edge. Two matching readings in a row are required before a crop is applied, so one noisy frame won't cause a flicker. Before trusting any edge reading at all, it also checks that the middle of the frame is meaningfully brighter than the bar cutoff - without that check, a full-frame fade to black (a scene transition, a loading screen, the gap between two videos) would look identical to "bars on every edge" and trigger a jarring, incorrect crop. Scanning only runs while the video is actually playing, it pauses itself when the video pauses and picks back up when it resumes.

Fixed modes (4:3, 16:10, 16:9, 2:1, 21:9, 2.39:1) skip the scan entirely and crop straight from the video's own encoded width and height to the chosen ratio, so they also work on sites where the canvas sampling can't run (see Known issues below). The crop alignment setting decides how a fixed-ratio crop is split between its two edges: evenly by default, or entirely on one edge if you'd rather keep the opposite one untouched.

Either way, the crop itself is a single CSS `transform: scale()` on the video element, with `transform-origin` set to the center of the region being kept, inside a wrapper with `overflow: hidden`. Because it's all expressed in relative terms, nothing needs to be recalculated on window resize.

Two extra mechanisms keep that crop actually visible once applied, instead of only right after it's set: a settings change (mode, zoom, stretch, alignment) always re-applies immediately using whatever black bars are already known, rather than waiting on a fresh detection pass, and a small watcher keeps an eye on the video's own `style` attribute, reapplying the crop if a site's own player script overwrites it, which some do in reaction to things like fullscreen toggles or quality switches. Entering or leaving fullscreen also explicitly triggers a reapply on its own, since that's the single most common time a player resizes the video out from under this extension.

```text
content script loads on every page
  -> finds the video (known selector, or largest visible <video>)
       -> auto: sample canvas every ~900ms while playing, confirm twice, then crop
       -> fixed ratio: read videoWidth/videoHeight once, crop immediately
            -> transform: scale() + transform-origin, clipped by a wrapper
  -> any settings change, fullscreen toggle, or unexpected style change
       re-applies the current crop using whatever is already known
```

Settings live in `chrome.storage.local` under one global key, read by both the popup and every content script instance through a small shared module (`shared-constants.js`) so the two can't drift out of sync on defaults, on which fixed ratios exist, or on which alignment options exist.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Remembers your crop mode, zoom, stretch setting, alignment, and on/off state |
| content script on `<all_urls>`, all frames | Finds and crops the video wherever it's actually playing - there's no way to know in advance which site or frame that will be |

That's genuinely all of it - no separate `host_permissions` entry (the content script's own `matches` list already covers the pages it runs on), no `tabs`, no `activeTab`, no `cookies`, no `scripting`, no `webRequest`. If a future version ever needs something new, this table gets updated in the same commit that adds it.

## Privacy and security

- No data collection of any kind - no analytics, no crash reporting, no telemetry, no update-check pings. The extension never contacts any server, including one of its own
- To find black bars in Auto detect mode, the extension draws the current video frame onto a small offscreen canvas, entirely inside your browser, and checks its brightness along each edge. That pixel data is used once, immediately discarded, and never stored or transmitted anywhere. Fixed modes don't even do this - they only read the video's own width and height
- Exactly five settings are ever stored, using the browser's own `chrome.storage.local`: crop mode, zoom level, stretch on/off, crop alignment, and the extension's enabled/disabled state
- `chrome.storage.local` on purpose, not `.sync` - your settings stay on this device rather than travelling through your browser account's sync
- No remote code loading - the full source ships inside the installed package, nothing is fetched or evaluated at runtime
- Full details live in the [Privacy Policy](https://letalab.eu/LetaGoUltraWide/Privacy_Policy.html), also hosted at [https://LetaLab.eu](https://letalab.eu)

## Known issues and support

Auto detect can't sample a frame from video played through a protected/DRM rendering path (this is normal browser behavior protecting the content, not a bug in the extension) - the canvas read fails quietly and auto detect simply does nothing on that site. Fixed ratio modes still work there, since they only need the video's width and height, not its pixels.

Amazon Prime Video doesn't have a confirmed player-specific selector yet - public information on its current internal markup is thin and dated, so it runs on the generic largest-video fallback for now, same as any unlisted site. The YouTube selector added for the largest-video fallback's known-selector list is a best-effort match on a long-standing class name, not something verified against a public source, if YouTube ever changes it the extension simply falls back to the largest-video match instead, same as before.

Running into either of those, or anything else that doesn't behave the way it should? Open a thread in [Issues](https://github.com/LetaLab/Leta-Go-UltraWide/issues).

## Directory structure

```text
├── leta-go-ultrawide/
│   ├── manifest.json
│   ├── shared-constants.js       defaults, the fixed-ratio list, and the alignment list, shared by content.js and the popup
│   ├── content.js                finds the video, runs auto detect, applies the crop, keeps it applied
│   ├── content.css                the crop wrapper's overflow and sizing rules
│   ├── icons/
│   │   ├── LetaGoUltraWide-16.png / -32.png / -48.png / -128.png
│   │   └── LetaLab-Favicon.png
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── LICENSE
├── Privacy_Policy.html    source for the page hosted at letalab.eu, not part of the extension
└── README.md              this file, not part of the extension
```

## License

MIT - see [`LICENSE`](LICENSE)

## Credits

Built by [LetaLab.eu](https://letalab.eu) - a small collection of tools built for actual daily use.
