// shared-constants.js
//
// Loaded before both content.js (as a content script, see manifest.json)
// and popup.js (via a <script> tag in popup.html), so the two contexts
// share one definition of the defaults, the fixed aspect ratios, and the
// alignment options. Plain script, no module system in either context, so
// this just defines one global object instead of several loose globals.

const LetaGoShared = {
  GLOBAL_KEY: 'letaGoSettings',

  DEFAULTS: {
    enabled: true,
    mode: 'auto',         // auto | one of FIXED_MODES[].value | 'off' (legacy:
                           // no longer offered in the popup, the enabled
                           // toggle is the one off switch now, content.js
                           // still honors an already-stored 'off' so nobody's
                           // existing choice silently changes underneath them
    zoom: 100,             // percent, 100 = no extra zoom on top of the crop
    stretch: false,
    alignment: 'center',  // center | start | end, see ALIGNMENTS below
    disableOnShorts: false // when true, skip youtube.com/shorts/... entirely,
                            // see isSuppressedHere() in content.js
  },

  // Fixed-ratio crop modes, ordered narrowest to widest. `value` is what's
  // stored in settings.mode and what popup.js uses as an <option value>.
  // `ratio` is width divided by height, used by content.js to compute the
  // crop. `label` is the popup dropdown text. Add or remove entries here
  // only, both the dropdown and the crop math read from this one list.
  FIXED_MODES: [
    { value: '4:3', ratio: 4 / 3, label: 'Force 4:3' },
    { value: '16:10', ratio: 16 / 10, label: 'Force 16:10' },
    { value: '16:9', ratio: 16 / 9, label: 'Force 16:9' },
    { value: '2:1', ratio: 2 / 1, label: 'Force 2:1 (streaming widescreen)' },
    { value: '21:9', ratio: 21 / 9, label: 'Force 21:9' },
    { value: '2.39:1', ratio: 2.39, label: 'Force 2.39:1 (Cinemascope)' }
  ],

  // How the trimmed fraction is split between the two edges being cropped
  // in a fixed-ratio mode. 'center' splits it evenly on both edges (the
  // original, still-default behavior). 'start'/'end' put the entire trim
  // on one edge, keeping the opposite edge untouched, useful when
  // something worth keeping (a logo, a picture-in-picture box, subtitles)
  // sits closer to one side. Only used by fixed-ratio modes, see the
  // comment on computeManualBars() in content.js for why auto-detect
  // doesn't use this.
  ALIGNMENTS: [
    { value: 'center', label: 'Center (default)' },
    { value: 'start', label: 'Keep top / left edge' },
    { value: 'end', label: 'Keep bottom / right edge' }
  ]
};
