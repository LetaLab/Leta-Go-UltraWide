// popup.js
//
// Reads and writes the global settings object in chrome.storage.local.
// Keeps one in-memory copy (currentSettings) and serializes writes
// through saveQueue so that two quick changes (e.g. flipping the
// enabled toggle right before picking a new mode) can never race each
// other and silently drop one of the changes, see CHANGELOG: this was
// bug #3 from the code review.
//
// Shared defaults, the fixed-ratio list, and the alignment list come
// from shared-constants.js, loaded before this file, see popup.html.

const modeSelect = document.getElementById('mode');
const alignmentField = document.getElementById('alignmentField');
const alignmentSelect = document.getElementById('alignment');
const enabledToggle = document.getElementById('enabled');
const zoomRange = document.getElementById('zoom');
const zoomValue = document.getElementById('zoomValue');
const stretchToggle = document.getElementById('stretch');
const status = document.getElementById('status');

let statusTimer = null;
let currentSettings = { ...LetaGoShared.DEFAULTS };
let saveQueue = Promise.resolve();

function populateModeOptions() {
  for (const m of LetaGoShared.FIXED_MODES) {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    modeSelect.appendChild(opt);
  }
}

function populateAlignmentOptions() {
  for (const a of LetaGoShared.ALIGNMENTS) {
    const opt = document.createElement('option');
    opt.value = a.value;
    opt.textContent = a.label;
    alignmentSelect.appendChild(opt);
  }
}

function showSaved() {
  status.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('visible'), 1500);
}

// Alignment only does anything in a fixed-ratio mode, see the comment on
// computeManualBars() in content.js, so it stays hidden the rest of the
// time rather than sitting there looking like it should do something.
function updateAlignmentVisibility() {
  const isFixedRatio = modeSelect.value !== 'auto' && modeSelect.value !== 'off';
  alignmentField.classList.toggle('hidden', !isFixedRatio);
}

function render(s) {
  enabledToggle.checked = s.enabled;
  modeSelect.value = s.mode;
  alignmentSelect.value = s.alignment;
  zoomRange.value = s.zoom;
  zoomValue.textContent = s.zoom + '%';
  stretchToggle.checked = s.stretch;
  updateAlignmentVisibility();
}

function save(partial) {
  currentSettings = { ...currentSettings, ...partial };
  const next = currentSettings;
  saveQueue = saveQueue.then(() => new Promise((resolve) => {
    chrome.storage.local.set({ [LetaGoShared.GLOBAL_KEY]: next }, () => {
      showSaved();
      resolve();
    });
  }));
  return saveQueue;
}

populateModeOptions();
populateAlignmentOptions();

chrome.storage.local.get({ [LetaGoShared.GLOBAL_KEY]: LetaGoShared.DEFAULTS }, (data) => {
  currentSettings = data[LetaGoShared.GLOBAL_KEY];
  render(currentSettings);
});

enabledToggle.addEventListener('change', () => save({ enabled: enabledToggle.checked }));
modeSelect.addEventListener('change', () => {
  updateAlignmentVisibility();
  save({ mode: modeSelect.value });
});
alignmentSelect.addEventListener('change', () => save({ alignment: alignmentSelect.value }));
stretchToggle.addEventListener('change', () => save({ stretch: stretchToggle.checked }));

zoomRange.addEventListener('input', () => {
  zoomValue.textContent = zoomRange.value + '%';
});
zoomRange.addEventListener('change', () => save({ zoom: Number(zoomRange.value) }));
