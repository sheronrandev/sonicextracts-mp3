// ══════════════════════════════════════════════════════════════
// PLATFORM TAB SWITCHING & AUTO-DETECTION
// ══════════════════════════════════════════════════════════════
const PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'];
let activePlatform = 'youtube';

function switchTab(platform) {
  if (!PLATFORMS.includes(platform)) return;
  activePlatform = platform;

  // Update tab button styles
  document.querySelectorAll('.platform-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.platform === platform);
  });

  // Show/hide panels
  PLATFORMS.forEach(p => {
    const panel = document.getElementById(`${p}-panel`);
    if (panel) {
      panel.classList.toggle('hidden', p !== platform);
    }
  });
}

function detectPlatform(url) {
  let cleanUrl = url.trim();
  if (!cleanUrl) return null;
  // If the URL doesn't have http/https, temporarily add it to check validity
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = 'https://' + cleanUrl;
  }
  try {
    const parsed = new URL(cleanUrl);
    const host = parsed.hostname.replace('www.', '').replace('m.', '');

    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com') return 'facebook';
    if (host === 'instagram.com') return 'instagram';
    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return 'tiktok';

    return null;
  } catch {
    return null;
  }
}

function handleUrlAutoDetect(inputEl, currentPlatform) {
  const url = inputEl.value.trim();
  if (!url) return;

  const detectedPlatform = detectPlatform(url);
  if (detectedPlatform && detectedPlatform !== currentPlatform) {
    // Switch to the detected platform's tab
    switchTab(detectedPlatform);

    // Get target input and button IDs
    const targetInputId = detectedPlatform === 'youtube' ? 'urlInput' : `${detectedPlatform.substring(0, 2)}UrlInput`;
    const targetBtnId = detectedPlatform === 'youtube' ? 'fetchBtn' : `${detectedPlatform.substring(0, 2)}FetchBtn`;

    const targetInput = document.getElementById(targetInputId);
    const targetBtn = document.getElementById(targetBtnId);

    if (targetInput && targetBtn) {
      targetInput.value = url;
      // Trigger the fetch/analysis on the target tab
      targetBtn.click();
    }

    // Clear the current input where the URL was pasted
    inputEl.value = '';
  }
}

// Attach auto-detection to inputs when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const inputs = [
    { id: 'urlInput', platform: 'youtube' },
    { id: 'fbUrlInput', platform: 'facebook' },
    { id: 'igUrlInput', platform: 'instagram' },
    { id: 'ttUrlInput', platform: 'tiktok' }
  ];

  inputs.forEach(({ id, platform }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => handleUrlAutoDetect(el, platform));
      el.addEventListener('paste', () => {
        setTimeout(() => handleUrlAutoDetect(el, platform), 50);
      });
    }
  });
});

// ══════════════════════════════════════════════════════════════
// YOUTUBE TAB (existing logic)
// ══════════════════════════════════════════════════════════════
const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const errorMsg = document.getElementById('errorMsg');
const previewCard = document.getElementById('previewCard');
const downloadOptionsPanel = document.getElementById('downloadOptionsPanel');
const typeAudioBtn = document.getElementById('typeAudioBtn');
const typeVideoBtn = document.getElementById('typeVideoBtn');
const formatGrid = document.getElementById('formatGrid');
const qualityGrid = document.getElementById('qualityGrid');
const confirmDownloadBtn = document.getElementById('confirmDownloadBtn');
const progressSection = document.getElementById('progressSection');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressLogo = document.getElementById('progressLogo');
const warningMsg = document.getElementById('warningMsg');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Playlist DOM references
const playlistSection = document.getElementById('playlistSection');
const playlistCapWarning = document.getElementById('playlistCapWarning');
const playlistCapText = document.getElementById('playlistCapText');
const playlistTitle = document.getElementById('playlistTitle');
const playlistQueue = document.getElementById('playlistQueue');
const plSelectAll = document.getElementById('plSelectAll');
const plSelectNone = document.getElementById('plSelectNone');
const plSelectedCount = document.getElementById('plSelectedCount');
const plModeButtons = document.getElementById('plModeButtons');
const plDownloadZip = document.getElementById('plDownloadZip');
const plDownloadIndividual = document.getElementById('plDownloadIndividual');
const plOverallProgress = document.getElementById('plOverallProgress');
const plOverallText = document.getElementById('plOverallText');
const plOverallPercent = document.getElementById('plOverallPercent');
const plOverallFill = document.getElementById('plOverallFill');
const plOverallRemaining = document.getElementById('plOverallRemaining');

let currentVideoUrl = '';
let currentVideoInfo = null;

// Playlist state
let playlistTracks = [];
let playlistSelected = new Set();
let isPlaylistMode = false;

// Download Options State
let selectedType = 'audio';
let selectedFormat = '';
let selectedQuality = '';

const AUDIO_FORMATS = [
  { id: 'MP3', desc: 'Universal, small size' },
  { id: 'AAC', desc: 'Better quality, Apple' },
  { id: 'FLAC', desc: 'Lossless, large file', lossless: true },
  { id: 'WAV', desc: 'Uncompressed studio', lossless: true },
  { id: 'OGG', desc: 'Open source, web' }
];

const VIDEO_FORMATS = [
  { id: 'MP4 (H.264)', desc: 'Most compatible' },
  { id: 'MP4 (H.265/HEVC)', desc: 'Smaller, newer' },
  { id: 'WEBM (VP9)', desc: 'Great for web' },
  { id: 'MKV', desc: 'Best container' }
];

const AUDIO_QUALITIES = ['320kbps', '256kbps', '192kbps', '128kbps'];

const HISTORY_KEY = 'sonicextract_history';
const MAX_HISTORY = 4;

// ── History helpers ──────────────────────────────────────

function getHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    if (history.length > MAX_HISTORY) {
      history.splice(MAX_HISTORY);
      saveHistory(history);
    }
    return history;
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(item) {
  const history = getHistory();
  const exists = history.findIndex(h => h.title === item.title);
  if (exists !== -1) history.splice(exists, 1);
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.pop();
  saveHistory(history);
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function generateWaveformBars() {
  const heights = [2, 4, 6, 8, 5, 3, 7, 4, 6, 2, 5, 3];
  return heights.map(h => `<div class="waveform-bar h-${h}"></div>`).join('');
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderHistory() {
  const history = getHistory();

  if (history.length === 0) {
    historyList.innerHTML = '';
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');

  const platformNames = {
    youtube: 'YouTube',
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok'
  };

  const platformBadges = {
    youtube: 'bg-red-500/10 text-red-400 border border-red-500/20',
    facebook: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    instagram: 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
    tiktok: 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
  };

  const platformIcons = {
    youtube: '▶️',
    facebook: '📘',
    instagram: '📸',
    tiktok: '🎵'
  };

  historyList.innerHTML = history.map((item, index) => {
    const platform = item.platform || 'youtube';
    const platName = platformNames[platform] || 'YouTube';
    const platBadge = platformBadges[platform] || platformBadges.youtube;
    const platIcon = platformIcons[platform] || platformIcons.youtube;

    let mediaType = 'MP3';
    if (item.type === 'playlist') {
      mediaType = 'PLAYLIST';
    } else if (item.type === 'video' || (item.platform && item.platform !== 'youtube')) {
      mediaType = 'VIDEO';
    }

    return `
      <div class="glass-card p-md rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-md group hover:bg-white/5 transition-all">
        <img alt="Thumbnail" class="w-16 h-16 rounded-lg object-cover bg-surface-container-high flex-shrink-0"
             src="${item.thumbnail || ''}"
             onerror="this.style.display='none'"/>
        <div class="flex-grow min-w-0 w-full">
          <h5 class="font-bold truncate text-on-surface mb-1">${escapeHtml(item.title)}</h5>
          <div class="flex flex-wrap items-center gap-2 sm:gap-md">
            <span class="font-mono-data text-mono-data text-on-surface-variant flex items-center gap-xs">
              <span class="material-symbols-outlined text-xs" data-icon="schedule">schedule</span> ${item.duration || '—'}
            </span>
            <span class="font-mono-data text-mono-data text-on-surface-variant flex items-center gap-xs">
              <span class="material-symbols-outlined text-xs" data-icon="person">person</span> ${escapeHtml(item.channel || '')}
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${platBadge}">
              ${platIcon} ${platName}
            </span>
            <span class="bg-[#00b88f]/10 text-[#00b88f] px-2 py-0.5 rounded text-[10px] font-bold">
              ${mediaType}
            </span>
            <span class="font-mono-data text-mono-data text-outline flex items-center gap-xs">
              <span class="material-symbols-outlined text-xs" data-icon="access_time">access_time</span> ${timeAgo(item.timestamp)}
            </span>
          </div>
        </div>
        <div class="hidden lg:flex items-center gap-[2px] h-8 px-lg flex-shrink-0">
          ${generateWaveformBars()}
        </div>
        <div class="flex items-center gap-xs w-full sm:w-auto justify-end mt-2 sm:mt-0">
          ${item.url ? `
          <button onclick="copyToClipboard('${item.url}', this)" class="p-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-on-surface-variant hover:text-[#00b88f]" title="Copy Link">
            <span class="material-symbols-outlined text-sm" data-icon="content_copy">content_copy</span>
          </button>
          ` : ''}
          <button onclick="removeHistoryItem(${index})" class="p-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-on-surface-variant hover:text-error" title="Remove">
            <span class="material-symbols-outlined text-sm" data-icon="close">close</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function copyToClipboard(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    if (btn) {
      const icon = btn.querySelector('.material-symbols-outlined');
      const oldIcon = icon.textContent;
      icon.textContent = 'check';
      icon.classList.add('text-success');
      setTimeout(() => {
        icon.textContent = oldIcon;
        icon.classList.remove('text-success');
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy link: ', err);
  });
}

function removeHistoryItem(index) {
  const history = getHistory();
  history.splice(index, 1);
  saveHistory(history);
  renderHistory();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Core helpers ─────────────────────────────────────────

function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  previewCard.classList.add('hidden');
  progressSection.classList.add('hidden');
  playlistSection.classList.add('hidden');
}

function resetProgressUI() {
  progressBar.style.width = '0%';
  progressBar.className = 'h-full bg-[#009f7b] progress-pulse transition-all duration-300';
  progressPercent.textContent = '';
  statusText.textContent = 'Initializing...';
  if (progressLogo) progressLogo.classList.remove('logo-pulse');
}

function hideAllSections() {
  errorMsg.classList.add('hidden');
  previewCard.classList.add('hidden');
  progressSection.classList.add('hidden');
  playlistSection.classList.add('hidden');
}

// ── Fetch video / playlist info ──────────────────────────

fetchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return showError('Please enter a valid YouTube URL');

  hideAllSections();
  fetchBtn.disabled = true;
  fetchBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm" data-icon="sync">sync</span> ANALYZING...`;
  isPlaylistMode = false;

  try {
    // Step 1: Detect if URL is a playlist
    const detectRes = await fetch(`/api/detect?url=${encodeURIComponent(url)}`);
    const detectData = await detectRes.json();

    if (detectData.isPlaylist) {
      // ── Playlist Mode ──
      isPlaylistMode = true;
      await loadPlaylist(url);
    } else {
      // ── Single Video Mode (existing flow) ──
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      console.log('📋 Received video info:', data.title, '| video_formats:', data.video_formats?.length || 0);

      document.getElementById('thumb').src = data.thumbnail;
      document.getElementById('title').textContent = data.title;
      document.getElementById('channel').textContent = data.channel;
      document.getElementById('duration').textContent = data.duration_string;
      data.is_long ? warningMsg.classList.remove('hidden') : warningMsg.classList.add('hidden');

      currentVideoUrl = url;
      currentVideoInfo = data;
      
      selectedType = 'audio';
      selectedFormat = '';
      selectedQuality = '';
      typeAudioBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps bg-[#00b88f] text-white shadow-[0_0_15px_rgba(0,184,143,0.3)] transition-all';
      typeVideoBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-white transition-all';
      renderFormats();
      renderQualities();
      updateConfirmBtn();
      
      previewCard.classList.remove('hidden');
    }
  } catch (err) {
    showError(err.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = `CONVERT TO MP3 <span class="material-symbols-outlined text-sm" data-icon="bolt" data-weight="fill" style="font-variation-settings: 'FILL' 1;">bolt</span>`;
  }
});

// ── Download Options UI ──────────────────────────────────────

function formatBytes(bytes, isEstimate) {
  if (!bytes || bytes === 0) return null; // null signals "Size unknown"
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formatted = parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  return isEstimate ? '~' + formatted : formatted;
}

function estimateAudioSize(format, bitrateKbps, duration) {
  if (!duration || duration <= 0) return null;
  let estimatedBytes = 0;

  const fmt = format.toUpperCase();
  if (fmt === 'WAV') {
    // Uncompressed: sampleRate × bitDepth × channels / 8
    const audioInfo = currentVideoInfo?.audio_info;
    const sampleRate = audioInfo?.sampleRate || 44100;
    estimatedBytes = (sampleRate * 16 * 2 / 8) * duration;
  } else if (fmt === 'FLAC') {
    // Lossless: use source audio bitrate × 3.5 expansion factor
    const audioInfo = currentVideoInfo?.audio_info;
    const sourceBitrate = audioInfo?.bestAudioBitrate || 128;
    estimatedBytes = (sourceBitrate * 1000 / 8) * 3.5 * duration;
  } else {
    // Lossy formats (MP3, AAC, OGG): bitrate × duration
    estimatedBytes = (bitrateKbps * 1000 / 8) * duration;
  }

  return estimatedBytes > 0 ? formatBytes(Math.round(estimatedBytes), true) : null;
}

function renderFormats() {
  const formats = selectedType === 'audio' ? AUDIO_FORMATS : VIDEO_FORMATS;
  formatGrid.innerHTML = formats.map(f => `
    <div class="format-card cursor-pointer p-3 rounded-lg border ${selectedFormat === f.id ? 'border-[#00b88f] bg-[#00b88f]/10 shadow-[0_0_10px_rgba(0,184,143,0.2)]' : 'border-white/10 hover:border-white/30 bg-surface-container-high'} transition-all text-center flex flex-col justify-center" data-id="${f.id}">
      <div class="font-bold text-sm text-on-surface mb-1">${f.id}</div>
      <div class="text-[10px] text-on-surface-variant leading-tight">${f.desc}</div>
    </div>
  `).join('');

  document.querySelectorAll('.format-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedFormat = card.dataset.id;
      selectedQuality = ''; // Reset quality when format changes
      renderFormats();
      renderQualities();
      updateConfirmBtn();
    });
  });
}

function renderQualities() {
  if (selectedType === 'audio' && !selectedFormat) {
    qualityGrid.innerHTML = '<p class="text-xs text-on-surface-variant">Select a format first</p>';
    return;
  }

  let html = '';
  if (selectedType === 'audio') {
    const isLossless = AUDIO_FORMATS.find(f => f.id === selectedFormat)?.lossless;
    const duration = currentVideoInfo?.audio_info?.duration || currentVideoInfo?.duration || 0;
    if (isLossless) {
      selectedQuality = 'Lossless';
      const sizeLabel = estimateAudioSize(selectedFormat, 0, duration);
      html = `<div class="p-2 px-4 rounded-full border border-[#00b88f] bg-[#00b88f]/10 text-sm text-[#00b88f] flex flex-col items-center">
        <span>Lossless — bitrate does not apply</span>
        ${sizeLabel ? `<span class="text-[10px] opacity-70 mt-0.5">${sizeLabel}</span>` : ''}
      </div>`;
    } else {
      html = AUDIO_QUALITIES.map(q => {
        const bitrateKbps = parseInt(q); // e.g. "320kbps" → 320
        const sizeLabel = estimateAudioSize(selectedFormat, bitrateKbps, duration);
        return `
          <div class="quality-pill cursor-pointer px-4 py-2 rounded-full border flex flex-col items-center justify-center ${selectedQuality === q ? 'border-[#00b88f] bg-[#00b88f]/10 text-[#00b88f]' : 'border-white/10 text-on-surface-variant hover:text-white'} transition-all min-w-[80px]" data-id="${q}">
            <span class="text-sm font-bold">${q}</span>
            <span class="text-[10px] opacity-70">${sizeLabel || '<span class="text-outline">Size unknown</span>'}</span>
          </div>
        `;
      }).join('');
    }
  } else {
    // Video — show qualities even before a format is selected (resolutions don't depend on container format)
    if (!selectedFormat) {
      qualityGrid.innerHTML = '<p class="text-xs text-on-surface-variant">Select a format first</p>';
      return;
    }
    if (currentVideoInfo && currentVideoInfo.video_formats && currentVideoInfo.video_formats.length > 0) {
      html = currentVideoInfo.video_formats.map(vf => {
        const sizeLabel = formatBytes(vf.size, vf.isEstimate);
        return `
          <div class="quality-pill cursor-pointer px-4 py-2 rounded-full border flex flex-col items-center justify-center ${selectedQuality === vf.height + 'p' ? 'border-[#00b88f] bg-[#00b88f]/10 text-[#00b88f]' : 'border-white/10 text-on-surface-variant hover:text-white'} transition-all min-w-[80px]" data-id="${vf.height}p">
            <span class="text-sm font-bold">${vf.height}p</span>
            <span class="text-[10px] opacity-70">${sizeLabel || '<span class="text-outline">Size unknown</span>'}</span>
          </div>
        `;
      }).join('');
    } else {
      console.warn('No video_formats in currentVideoInfo:', JSON.stringify(currentVideoInfo));
      html = '<p class="text-xs text-on-surface-variant">No video qualities found — try re-fetching the URL</p>';
    }
  }

  qualityGrid.innerHTML = html;

  document.querySelectorAll('.quality-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      selectedQuality = pill.dataset.id;
      renderQualities();
      updateConfirmBtn();
    });
  });
}

function updateConfirmBtn() {
  if (selectedFormat && selectedQuality) {
    confirmDownloadBtn.disabled = false;
  } else {
    confirmDownloadBtn.disabled = true;
  }
}

typeAudioBtn.addEventListener('click', () => {
  selectedType = 'audio';
  selectedFormat = '';
  selectedQuality = '';
  typeAudioBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps bg-[#00b88f] text-white shadow-[0_0_15px_rgba(0,184,143,0.3)] transition-all';
  typeVideoBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-white transition-all';
  renderFormats();
  renderQualities();
  updateConfirmBtn();
});

typeVideoBtn.addEventListener('click', () => {
  selectedType = 'video';
  selectedFormat = '';
  selectedQuality = '';
  typeVideoBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps bg-[#00b88f] text-white shadow-[0_0_15px_rgba(0,184,143,0.3)] transition-all';
  typeAudioBtn.className = 'px-6 py-2 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:text-white transition-all';
  renderFormats();
  renderQualities();
  updateConfirmBtn();
});

// ── Download & progress (single video) ───────────────────

confirmDownloadBtn.addEventListener('click', async () => {
  if (!currentVideoUrl) return;

  const jobId = generateUUID();

  previewCard.classList.add('hidden');
  progressSection.classList.remove('hidden');
  resetProgressUI();

  const eventSource = new EventSource(`/api/progress?jobId=${jobId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'downloading') {
      if (progressLogo) progressLogo.classList.add('logo-pulse');
      statusText.textContent = `Downloading audio stream...`;
      progressPercent.textContent = `${data.progress}%`;
      progressBar.style.width = `${data.progress}%`;
    } else if (data.status === 'converting') {
      statusText.textContent = 'Converting to MP3 & embedding metadata...';
      progressPercent.textContent = '100%';
      progressBar.style.width = '100%';
      progressBar.className = 'h-full progress-pulse transition-all duration-300';
      progressBar.style.backgroundColor = 'var(--warning)';
    } else if (data.status === 'ready') {
      if (progressLogo) progressLogo.classList.remove('logo-pulse');
      statusText.textContent = 'Extraction complete!';
      progressPercent.textContent = '✓';
      progressBar.style.backgroundColor = 'var(--success)';
      eventSource.close();

      if (currentVideoInfo) {
        addToHistory({
          title: currentVideoInfo.title || 'Unknown',
          channel: currentVideoInfo.channel || '',
          duration: currentVideoInfo.duration_string || '',
          thumbnail: currentVideoInfo.thumbnail || '',
          timestamp: Date.now(),
          file: data.file || '',
          jobId: jobId,
          url: currentVideoUrl
        });
      }

      window.location.href = `/api/file?jobId=${jobId}&file=${data.file}`;

      setTimeout(() => {
        statusText.textContent = 'Done! Ready for next extraction.';
        urlInput.value = '';
      }, 2500);
    } else if (data.status === 'error') {
      if (progressLogo) progressLogo.classList.remove('logo-pulse');
      eventSource.close();
      showError(data.message || 'An error occurred during processing.');
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    showError('Lost connection to processing server.');
  };

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentVideoUrl, jobId, type: selectedType, format: selectedFormat, quality: selectedQuality })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to start download');
    }
  } catch (err) {
    eventSource.close();
    showError(err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// PLAYLIST LOGIC
// ═══════════════════════════════════════════════════════════

async function loadPlaylist(url) {
  playlistSection.classList.remove('hidden');
  playlistTitle.textContent = 'Loading tracks...';
  playlistQueue.innerHTML = '<p class="text-on-surface-variant text-sm text-center py-4">Fetching playlist metadata...</p>';
  plModeButtons.classList.add('hidden');
  plOverallProgress.classList.add('hidden');
  playlistCapWarning.classList.add('hidden');

  try {
    const res = await fetch(`/api/playlist/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist');

    playlistTracks = data.tracks;
    playlistSelected = new Set(playlistTracks.map((_, i) => i));
    currentVideoUrl = url;

    if (data.capped) {
      playlistCapWarning.classList.remove('hidden');
      playlistCapText.textContent = `This playlist has more than ${data.cap} tracks. Only the first ${data.cap} are shown.`;
    }

    playlistTitle.textContent = `${data.tracks.length} Tracks`;
    renderPlaylistQueue();
    plModeButtons.classList.remove('hidden');
  } catch (err) {
    throw err;
  }
}

function renderPlaylistQueue(processingState = null) {
  playlistQueue.innerHTML = playlistTracks.map((track, i) => {
    const selected = playlistSelected.has(i);
    const isProcessing = !!processingState;
    const trackState = processingState ? (processingState[track.index] || 'queued') : null;
    const deselectedClass = !selected ? 'deselected' : '';

    let badgeHtml = '';
    if (isProcessing) {
      const badgeMap = {
        queued: '<span class="track-badge badge-queued">Queued</span>',
        downloading: '<span class="track-badge badge-downloading">Downloading</span>',
        converting: '<span class="track-badge badge-converting">Converting</span>',
        done: '<span class="track-badge badge-done">Done</span>',
        failed: '<span class="track-badge badge-failed">Failed</span>',
      };
      badgeHtml = badgeMap[trackState] || badgeMap.queued;
    }

    return `
      <div class="playlist-track-card ${deselectedClass}" data-track-index="${i}">
        ${!isProcessing ? `<input type="checkbox" class="track-checkbox" data-idx="${i}" ${selected ? 'checked' : ''} />` : ''}
        <span class="track-num">${i + 1}</span>
        <img class="track-thumb" src="${track.thumbnail}" onerror="this.style.visibility='hidden'" alt="" />
        <span class="track-title flex-grow min-w-0">${escapeHtml(track.title)}</span>
        ${track.duration_string ? `<span class="text-on-surface-variant text-xs flex-shrink-0">${track.duration_string}</span>` : ''}
        ${badgeHtml}
      </div>
    `;
  }).join('');

  // Re-attach checkbox listeners if not processing
  if (!processingState) {
    playlistQueue.querySelectorAll('.track-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (e.target.checked) {
          playlistSelected.add(idx);
        } else {
          playlistSelected.delete(idx);
        }
        updateTrackCardVisuals();
        updateSelectedCount();
      });
    });
  }
  updateSelectedCount();
}

function updateTrackCardVisuals() {
  playlistQueue.querySelectorAll('.playlist-track-card').forEach(card => {
    const idx = parseInt(card.dataset.trackIndex);
    if (playlistSelected.has(idx)) {
      card.classList.remove('deselected');
    } else {
      card.classList.add('deselected');
    }
  });
}

function updateSelectedCount() {
  const count = playlistSelected.size;
  plSelectedCount.textContent = `${count} of ${playlistTracks.length} tracks selected`;
}

// Select all / none
plSelectAll.addEventListener('click', () => {
  playlistSelected = new Set(playlistTracks.map((_, i) => i));
  renderPlaylistQueue();
});

plSelectNone.addEventListener('click', () => {
  playlistSelected = new Set();
  renderPlaylistQueue();
});

// ── Playlist Download ────────────────────────────────────

function startPlaylistDownload(mode) {
  if (playlistSelected.size === 0) {
    return showError('Please select at least one track.');
  }

  const jobId = generateUUID();
  const selectedTracks = [...playlistSelected].map(i => playlistTracks[i]);
  const total = selectedTracks.length;

  // Disable mode buttons
  plModeButtons.classList.add('hidden');
  plSelectAll.disabled = true;
  plSelectNone.disabled = true;

  // Show overall progress
  plOverallProgress.classList.remove('hidden');
  plOverallText.textContent = `Processing 0 of ${total}...`;
  plOverallPercent.textContent = '0%';
  plOverallFill.style.width = '0%';
  plOverallRemaining.textContent = `${total} tracks remaining`;

  // Track states for badge updates
  const trackStates = {};
  selectedTracks.forEach(t => { trackStates[t.index] = 'queued'; });

  // Re-render queue in processing mode (no checkboxes, with badges)
  renderPlaylistQueue(trackStates);

  // Open SSE connection
  const eventSource = new EventSource(`/api/playlist/progress?jobId=${jobId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'track_progress') {
      // Update individual track badge
      trackStates[data.track] = data.status;
      updateTrackBadge(data.track, data.status);

      // Update overall progress
      if (data.completed !== undefined) {
        const pct = Math.round((data.completed / data.total) * 100);
        plOverallText.textContent = `Processing ${data.completed} of ${data.total}...`;
        plOverallPercent.textContent = `${pct}%`;
        plOverallFill.style.width = `${pct}%`;
        plOverallRemaining.textContent = `${data.total - data.completed} tracks remaining`;
      }

      // Scroll the currently active track into view
      if (data.status === 'downloading') {
        const card = playlistQueue.querySelector(`[data-track-index="${selectedTracks.findIndex(t => t.index === data.track)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    if (data.type === 'status') {
      if (data.status === 'zipping') {
        plOverallText.textContent = 'Generating ZIP file...';
      }

      if (data.status === 'complete') {
        eventSource.close();
        plOverallText.textContent = 'Complete!';
        plOverallPercent.textContent = '✓';
        plOverallFill.style.width = '100%';

        const summaryText = data.failedCount > 0
          ? `${data.successCount} tracks downloaded, ${data.failedCount} failed`
          : `All ${data.successCount} tracks downloaded successfully`;
        plOverallRemaining.textContent = summaryText;

        // Add to history
        addToHistory({
          title: `Playlist (${data.successCount} tracks)`,
          channel: '',
          duration: '',
          thumbnail: playlistTracks[0]?.thumbnail || '',
          timestamp: Date.now(),
          type: 'playlist',
          url: currentVideoUrl
        });

        if (data.mode === 'zip') {
          // Trigger ZIP download
          window.location.href = data.downloadUrl;
        } else if (data.mode === 'individual') {
          // Download each file sequentially with small delays
          downloadFilesSequentially(data.files, jobId);
        }
      }

      if (data.status === 'error') {
        eventSource.close();
        plOverallText.textContent = 'Error';
        plOverallRemaining.textContent = data.message;
      }
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };

  // Fire the download request
  fetch('/api/playlist/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: currentVideoUrl, jobId, mode, selectedTracks })
  }).catch(err => {
    eventSource.close();
    showError(err.message);
  });
}

function updateTrackBadge(trackIndex, status) {
  // Find the card by the track's original index
  const cards = playlistQueue.querySelectorAll('.playlist-track-card');
  for (const card of cards) {
    const badge = card.querySelector('.track-badge');
    // Match by checking if this card contains the right track
    const trackIdx = parseInt(card.dataset.trackIndex);
    const track = playlistTracks[trackIdx];
    if (track && track.index === trackIndex && badge) {
      const badgeMap = {
        queued: { class: 'badge-queued', text: 'Queued' },
        downloading: { class: 'badge-downloading', text: 'Downloading' },
        converting: { class: 'badge-converting', text: 'Converting' },
        done: { class: 'badge-done', text: 'Done' },
        failed: { class: 'badge-failed', text: 'Failed' },
      };
      const b = badgeMap[status] || badgeMap.queued;
      badge.className = `track-badge ${b.class}`;
      badge.textContent = b.text;
      break;
    }
  }
}

async function downloadFilesSequentially(files, jobId) {
  for (let i = 0; i < files.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 600));
    const a = document.createElement('a');
    a.href = files[i].url;
    a.download = files[i].name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  // Signal cleanup after a delay
  setTimeout(() => {
    fetch(`/api/playlist/cleanup?jobId=${jobId}`, { method: 'DELETE' }).catch(() => {});
  }, 5000);
}

// Bind download mode buttons
plDownloadZip.addEventListener('click', () => startPlaylistDownload('zip'));
plDownloadIndividual.addEventListener('click', () => startPlaylistDownload('individual'));

// ── Clear history button ─────────────────────────────────

clearHistoryBtn.addEventListener('click', () => {
  clearHistory();
});

// ── Render history on page load ──────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
});

// ══════════════════════════════════════════════════════════════
// AUDIO IDENTIFICATION UNIFIED UTILITY
// ══════════════════════════════════════════════════════════════
async function identifyAudio(videoUrl, buttonEl, resultEl) {
  if (!videoUrl) return;
  buttonEl.disabled = true;
  const originalText = buttonEl.innerHTML;
  buttonEl.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">sync</span> IDENTIFYING...`;
  resultEl.classList.add('hidden');
  resultEl.innerHTML = '';

  try {
    const res = await fetch('/api/identify-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to identify audio');
    }

    resultEl.classList.remove('hidden');
    if (data.found) {
      resultEl.innerHTML = `
        <div class="glass-card p-md rounded-xl border border-[#00b88f]/30 bg-[#00b88f]/5 flex flex-col md:flex-row items-center gap-md">
          ${data.albumArt ? `<img src="${data.albumArt}" alt="Album Art" class="w-24 h-24 rounded-lg object-cover shadow-[0_0_15px_rgba(0,184,143,0.2)]" />` : `
            <div class="w-24 h-24 rounded-lg bg-surface-container-high flex items-center justify-center text-outline-variant">
              <span class="material-symbols-outlined text-4xl">music_note</span>
            </div>
          `}
          <div class="flex-grow min-w-0 w-full text-center md:text-left">
            <h4 class="font-bold text-lg text-on-surface truncate">${escapeHtml(data.title)}</h4>
            <p class="text-primary font-semibold text-sm mb-1">${escapeHtml(data.artist)}</p>
            ${data.album ? `<p class="text-on-surface-variant text-xs mb-1">Album: ${escapeHtml(data.album)} ${data.year ? `(${data.year})` : ''}</p>` : ''}
            <div class="flex flex-wrap justify-center md:justify-start gap-xs mt-3">
              ${data.links.spotify ? `
                <a href="${data.links.spotify}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#1DB954]/10 text-[#1DB954] border border-[#1DB954]/20 hover:bg-[#1DB954]/20 transition-all">
                  🎧 Spotify
                </a>
              ` : ''}
              ${data.links.appleMusic ? `
                <a href="${data.links.appleMusic}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#FC3C44]/10 text-[#FC3C44] border border-[#FC3C44]/20 hover:bg-[#FC3C44]/20 transition-all">
                  🍎 Apple Music
                </a>
              ` : ''}
              ${data.links.youtubeMusic ? `
                <a href="${data.links.youtubeMusic}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#FF0000]/10 text-[#FF0000] border border-[#FF0000]/20 hover:bg-[#FF0000]/20 transition-all">
                  ▶️ YouTube Music
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      resultEl.innerHTML = `
        <div class="glass-card p-sm rounded-xl border border-white/10 bg-white/3 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-outline-variant text-sm">info</span>
          <span class="text-on-surface-variant text-xs font-semibold">${escapeHtml(data.message || 'Original audio — no match found')}</span>
        </div>
      `;
    }
  } catch (err) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div class="p-sm rounded-xl border border-error bg-error/5 text-error text-xs text-center flex items-center justify-center gap-2">
        <span class="material-symbols-outlined text-sm">error</span>
        <span>${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalText;
  }
}

// Also render immediately in case DOMContentLoaded already fired
renderHistory();

// ══════════════════════════════════════════════════════════════
// FACEBOOK TAB LOGIC
// ══════════════════════════════════════════════════════════════

(function() {
  const fbUrlInput = document.getElementById('fbUrlInput');
  const fbFetchBtn = document.getElementById('fbFetchBtn');
  const fbErrorMsg = document.getElementById('fbErrorMsg');
  const fbPreviewCard = document.getElementById('fbPreviewCard');
  const fbProgressSection = document.getElementById('fbProgressSection');
  const fbStatusText = document.getElementById('fbStatusText');
  const fbProgressBar = document.getElementById('fbProgressBar');
  const fbProgressPercent = document.getElementById('fbProgressPercent');
  const fbDownloadBtn = document.getElementById('fbDownloadBtn');
  const fbIdentifyAudioBtn = document.getElementById('fbIdentifyAudioBtn');
  const fbFormatGrid = document.getElementById('fbFormatGrid');
  const fbQualityGrid = document.getElementById('fbQualityGrid');

  let fbVideoUrl = '';
  let fbVideoInfo = null;
  let fbSelectedFormat = '';
  let fbSelectedQuality = '';

  const FB_FORMATS = [
    { id: 'MP4 (H.264)', desc: 'Most compatible' },
    { id: 'MP4 (H.265/HEVC)', desc: 'Smaller, newer' }
  ];

  function fbShowError(msg) {
    fbErrorMsg.textContent = msg;
    fbErrorMsg.classList.remove('hidden');
    fbPreviewCard.classList.add('hidden');
    fbProgressSection.classList.add('hidden');
  }

  function fbHideAll() {
    fbErrorMsg.classList.add('hidden');
    fbPreviewCard.classList.add('hidden');
    fbProgressSection.classList.add('hidden');
  }

  function fbRenderFormats() {
    fbFormatGrid.innerHTML = FB_FORMATS.map(f => `
      <div class="format-card cursor-pointer p-3 rounded-lg border ${fbSelectedFormat === f.id ? 'border-[#00b88f] bg-[#00b88f]/10 shadow-[0_0_10px_rgba(0,184,143,0.2)]' : 'border-white/10 hover:border-white/30 bg-surface-container-high'} transition-all text-center" data-id="${f.id}">
        <div class="font-bold text-sm text-on-surface mb-1">${f.id}</div>
        <div class="text-[10px] text-on-surface-variant">${f.desc}</div>
      </div>
    `).join('');

    fbFormatGrid.querySelectorAll('.format-card').forEach(card => {
      card.addEventListener('click', () => {
        fbSelectedFormat = card.dataset.id;
        fbSelectedQuality = '';
        fbRenderFormats();
        fbRenderQualities();
        fbUpdateDownloadBtn();
      });
    });
  }

  function fbRenderQualities() {
    if (!fbVideoInfo || !fbVideoInfo.video_formats || !fbSelectedFormat) {
      fbQualityGrid.innerHTML = '<p class="text-xs text-on-surface-variant">Select a format first</p>';
      return;
    }
    fbQualityGrid.innerHTML = fbVideoInfo.video_formats.map(vf => {
      const sizeLabel = formatBytes(vf.size, vf.isEstimate);
      return `
        <div class="quality-pill cursor-pointer px-4 py-2 rounded-full border flex flex-col items-center justify-center ${fbSelectedQuality === vf.height + 'p' ? 'border-[#00b88f] bg-[#00b88f]/10 text-[#00b88f]' : 'border-white/10 text-on-surface-variant hover:text-white'} transition-all min-w-[80px]" data-id="${vf.height}p">
          <span class="text-sm font-bold">${vf.height}p</span>
          <span class="text-[10px] opacity-70">${sizeLabel || '<span class="text-outline">Size unknown</span>'}</span>
        </div>
      `;
    }).join('');

    fbQualityGrid.querySelectorAll('.quality-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        fbSelectedQuality = pill.dataset.id;
        fbRenderQualities();
        fbUpdateDownloadBtn();
      });
    });
  }

  function fbUpdateDownloadBtn() {
    fbDownloadBtn.disabled = !(fbSelectedFormat && fbSelectedQuality);
  }

  fbFetchBtn.addEventListener('click', async () => {
    const url = fbUrlInput.value.trim();
    if (!url) return fbShowError('Please enter a valid Facebook video URL');

    fbHideAll();
    fbFetchBtn.disabled = true;
    fbFetchBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">sync</span> ANALYZING...`;

    try {
      const res = await fetch(`/api/facebook/info?url=${encodeURIComponent(url)}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      document.getElementById('fbThumb').src = data.thumbnail;
      document.getElementById('fbTitle').textContent = data.title;
      document.getElementById('fbUploader').textContent = data.uploader;
      document.getElementById('fbDuration').textContent = data.duration_string;

      fbVideoUrl = url;
      fbVideoInfo = data;
      fbSelectedFormat = '';
      fbSelectedQuality = '';
      fbRenderFormats();
      fbRenderQualities();
      fbUpdateDownloadBtn();

      fbPreviewCard.classList.remove('hidden');
      fbIdentifyAudioBtn.disabled = false;
    } catch (err) {
      fbShowError(err.message);
    } finally {
      fbFetchBtn.disabled = false;
      fbFetchBtn.innerHTML = `FETCH VIDEO <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">bolt</span>`;
    }
  });

  fbDownloadBtn.addEventListener('click', async () => {
    if (!fbVideoUrl) return;

    const jobId = generateUUID();
    fbPreviewCard.classList.add('hidden');
    fbProgressSection.classList.remove('hidden');
    fbProgressBar.style.width = '0%';
    fbProgressBar.style.backgroundColor = '';
    fbProgressBar.className = 'h-full bg-[#009f7b] progress-pulse transition-all duration-300';
    fbStatusText.textContent = 'Initializing...';
    fbProgressPercent.textContent = '';

    const eventSource = new EventSource(`/api/facebook/progress?jobId=${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'downloading') {
        fbStatusText.textContent = 'Downloading video...';
        fbProgressPercent.textContent = `${data.progress}%`;
        fbProgressBar.style.width = `${data.progress}%`;
      } else if (data.status === 'processing') {
        fbStatusText.textContent = 'Processing & embedding metadata...';
        fbProgressPercent.textContent = '100%';
        fbProgressBar.style.width = '100%';
        fbProgressBar.style.backgroundColor = 'var(--warning)';
      } else if (data.status === 'ready') {
        fbStatusText.textContent = 'Download complete!';
        fbProgressPercent.textContent = '✓';
        fbProgressBar.style.backgroundColor = 'var(--success)';
        eventSource.close();

        addToHistory({
          title: fbVideoInfo?.title || 'Facebook Video',
          channel: fbVideoInfo?.uploader || '',
          duration: fbVideoInfo?.duration_string || '',
          thumbnail: fbVideoInfo?.thumbnail || '',
          timestamp: Date.now(),
          platform: 'facebook',
          url: fbVideoUrl,
          type: 'video'
        });

        window.location.href = `/api/file?jobId=${jobId}&file=${data.file}`;
      } else if (data.status === 'error') {
        eventSource.close();
        fbShowError(data.message || 'An error occurred during processing.');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      fbShowError('Lost connection to processing server.');
    };

    try {
      const res = await fetch('/api/facebook/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fbVideoUrl, jobId, format: fbSelectedFormat, quality: fbSelectedQuality })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start download');
      }
    } catch (err) {
      eventSource.close();
      fbShowError(err.message);
    }
  });

  fbIdentifyAudioBtn.addEventListener('click', () => {
    const resultEl = document.getElementById('fbAudioResult');
    identifyAudio(fbVideoUrl, fbIdentifyAudioBtn, resultEl);
  });
})();

// ══════════════════════════════════════════════════════════════
// INSTAGRAM TAB LOGIC
// ══════════════════════════════════════════════════════════════

(function() {
  const igUrlInput = document.getElementById('igUrlInput');
  const igFetchBtn = document.getElementById('igFetchBtn');
  const igErrorMsg = document.getElementById('igErrorMsg');
  const igPreviewCard = document.getElementById('igPreviewCard');
  const igProgressSection = document.getElementById('igProgressSection');
  const igStatusText = document.getElementById('igStatusText');
  const igProgressBar = document.getElementById('igProgressBar');
  const igProgressPercent = document.getElementById('igProgressPercent');
  const igDownloadBtn = document.getElementById('igDownloadBtn');
  const igIdentifyAudioBtn = document.getElementById('igIdentifyAudioBtn');

  let igVideoUrl = '';
  let igVideoInfo = null;

  function igShowError(msg) {
    igErrorMsg.textContent = msg;
    igErrorMsg.classList.remove('hidden');
    igPreviewCard.classList.add('hidden');
    igProgressSection.classList.add('hidden');
  }

  function igHideAll() {
    igErrorMsg.classList.add('hidden');
    igPreviewCard.classList.add('hidden');
    igProgressSection.classList.add('hidden');
  }

  igFetchBtn.addEventListener('click', async () => {
    const url = igUrlInput.value.trim();
    if (!url) return igShowError('Please enter a valid Instagram URL');

    igHideAll();
    igFetchBtn.disabled = true;
    igFetchBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">sync</span> ANALYZING...`;

    try {
      const res = await fetch(`/api/instagram/info?url=${encodeURIComponent(url)}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      document.getElementById('igThumb').src = data.thumbnail;
      document.getElementById('igCaption').textContent = data.caption || data.title;
      document.getElementById('igUploader').textContent = `@${data.uploader}`;
      document.getElementById('igDuration').textContent = data.duration_string;

      igVideoUrl = url;
      igVideoInfo = data;

      igPreviewCard.classList.remove('hidden');
      igIdentifyAudioBtn.disabled = false;
    } catch (err) {
      igShowError(err.message);
    } finally {
      igFetchBtn.disabled = false;
      igFetchBtn.innerHTML = `FETCH REEL <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">bolt</span>`;
    }
  });

  igDownloadBtn.addEventListener('click', async () => {
    if (!igVideoUrl) return;

    const jobId = generateUUID();
    igPreviewCard.classList.add('hidden');
    igProgressSection.classList.remove('hidden');
    igProgressBar.style.width = '0%';
    igProgressBar.style.backgroundColor = '';
    igProgressBar.className = 'h-full bg-[#009f7b] progress-pulse transition-all duration-300';
    igStatusText.textContent = 'Initializing...';
    igProgressPercent.textContent = '';

    const eventSource = new EventSource(`/api/instagram/progress?jobId=${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'downloading') {
        igStatusText.textContent = 'Downloading reel...';
        igProgressPercent.textContent = `${data.progress}%`;
        igProgressBar.style.width = `${data.progress}%`;
      } else if (data.status === 'processing') {
        igStatusText.textContent = 'Processing video...';
        igProgressPercent.textContent = '100%';
        igProgressBar.style.width = '100%';
        igProgressBar.style.backgroundColor = 'var(--warning)';
      } else if (data.status === 'ready') {
        igStatusText.textContent = 'Download complete!';
        igProgressPercent.textContent = '✓';
        igProgressBar.style.backgroundColor = 'var(--success)';
        eventSource.close();

        addToHistory({
          title: igVideoInfo?.caption || igVideoInfo?.title || 'Instagram Video',
          channel: igVideoInfo?.uploader || '',
          duration: igVideoInfo?.duration_string || '',
          thumbnail: igVideoInfo?.thumbnail || '',
          timestamp: Date.now(),
          platform: 'instagram',
          url: igVideoUrl,
          type: 'video'
        });

        window.location.href = `/api/file?jobId=${jobId}&file=${data.file}`;
      } else if (data.status === 'error') {
        eventSource.close();
        igShowError(data.message || 'An error occurred during processing.');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      igShowError('Lost connection to processing server.');
    };

    try {
      const res = await fetch('/api/instagram/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: igVideoUrl, jobId })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start download');
      }
    } catch (err) {
      eventSource.close();
      igShowError(err.message);
    }
  });

  igIdentifyAudioBtn.addEventListener('click', () => {
    const resultEl = document.getElementById('igAudioResult');
    identifyAudio(igVideoUrl, igIdentifyAudioBtn, resultEl);
  });
})();

// ══════════════════════════════════════════════════════════════
// TIKTOK TAB LOGIC
// ══════════════════════════════════════════════════════════════

(function() {
  const ttUrlInput = document.getElementById('ttUrlInput');
  const ttFetchBtn = document.getElementById('ttFetchBtn');
  const ttErrorMsg = document.getElementById('ttErrorMsg');
  const ttPreviewCard = document.getElementById('ttPreviewCard');
  const ttProgressSection = document.getElementById('ttProgressSection');
  const ttStatusText = document.getElementById('ttStatusText');
  const ttProgressBar = document.getElementById('ttProgressBar');
  const ttProgressPercent = document.getElementById('ttProgressPercent');
  const ttDownloadNoWM = document.getElementById('ttDownloadNoWM');
  const ttDownloadWM = document.getElementById('ttDownloadWM');
  const ttIdentifyAudioBtn = document.getElementById('ttIdentifyAudioBtn');

  let ttVideoUrl = '';
  let ttVideoInfo = null;

  function ttShowError(msg) {
    ttErrorMsg.textContent = msg;
    ttErrorMsg.classList.remove('hidden');
    ttPreviewCard.classList.add('hidden');
    ttProgressSection.classList.add('hidden');
  }

  function ttHideAll() {
    ttErrorMsg.classList.add('hidden');
    ttPreviewCard.classList.add('hidden');
    ttProgressSection.classList.add('hidden');
  }

  function formatCount(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  ttFetchBtn.addEventListener('click', async () => {
    const url = ttUrlInput.value.trim();
    if (!url) return ttShowError('Please enter a valid TikTok video URL');

    ttHideAll();
    ttFetchBtn.disabled = true;
    ttFetchBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">sync</span> ANALYZING...`;

    try {
      const res = await fetch(`/api/tiktok/info?url=${encodeURIComponent(url)}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      document.getElementById('ttThumb').src = data.thumbnail;
      document.getElementById('ttCaption').textContent = data.caption || data.title;
      document.getElementById('ttUploader').textContent = `@${data.uploader}`;
      document.getElementById('ttDuration').textContent = data.duration_string;

      // Like & view counts
      const ttLikes = document.getElementById('ttLikes');
      const ttViews = document.getElementById('ttViews');
      if (data.like_count) {
        document.getElementById('ttLikeCount').textContent = formatCount(data.like_count);
        ttLikes.classList.remove('hidden');
      } else {
        ttLikes.classList.add('hidden');
      }
      if (data.view_count) {
        document.getElementById('ttViewCount').textContent = formatCount(data.view_count);
        ttViews.classList.remove('hidden');
      } else {
        ttViews.classList.add('hidden');
      }

      ttVideoUrl = url;
      ttVideoInfo = data;

      ttPreviewCard.classList.remove('hidden');
      ttIdentifyAudioBtn.disabled = false;
    } catch (err) {
      ttShowError(err.message);
    } finally {
      ttFetchBtn.disabled = false;
      ttFetchBtn.innerHTML = `FETCH VIDEO <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">bolt</span>`;
    }
  });

  function ttStartDownload(withWatermark) {
    if (!ttVideoUrl) return;

    const jobId = generateUUID();
    ttPreviewCard.classList.add('hidden');
    ttProgressSection.classList.remove('hidden');
    ttProgressBar.style.width = '0%';
    ttProgressBar.style.backgroundColor = '';
    ttProgressBar.className = 'h-full bg-[#009f7b] progress-pulse transition-all duration-300';
    ttStatusText.textContent = 'Initializing...';
    ttProgressPercent.textContent = '';

    const eventSource = new EventSource(`/api/tiktok/progress?jobId=${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'downloading') {
        ttStatusText.textContent = `Downloading ${withWatermark ? '(with watermark)' : '(no watermark)'}...`;
        ttProgressPercent.textContent = `${data.progress}%`;
        ttProgressBar.style.width = `${data.progress}%`;
      } else if (data.status === 'processing') {
        ttStatusText.textContent = 'Processing video...';
        ttProgressPercent.textContent = '100%';
        ttProgressBar.style.width = '100%';
        ttProgressBar.style.backgroundColor = 'var(--warning)';
      } else if (data.status === 'ready') {
        ttStatusText.textContent = 'Download complete!';
        ttProgressPercent.textContent = '✓';
        ttProgressBar.style.backgroundColor = 'var(--success)';
        eventSource.close();

        addToHistory({
          title: ttVideoInfo?.caption || ttVideoInfo?.title || 'TikTok Video',
          channel: ttVideoInfo?.uploader || '',
          duration: ttVideoInfo?.duration_string || '',
          thumbnail: ttVideoInfo?.thumbnail || '',
          timestamp: Date.now(),
          platform: 'tiktok',
          url: ttVideoUrl,
          type: 'video'
        });

        window.location.href = `/api/file?jobId=${jobId}&file=${data.file}`;
      } else if (data.status === 'error') {
        eventSource.close();
        ttShowError(data.message || 'An error occurred during processing.');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      ttShowError('Lost connection to processing server.');
    };

    fetch('/api/tiktok/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ttVideoUrl, jobId, watermark: withWatermark })
    }).catch(err => {
      eventSource.close();
      ttShowError(err.message);
    });
  }

  ttDownloadNoWM.addEventListener('click', () => ttStartDownload(false));
  ttDownloadWM.addEventListener('click', () => ttStartDownload(true));

  ttIdentifyAudioBtn.addEventListener('click', () => {
    const resultEl = document.getElementById('ttAudioResult');
    identifyAudio(ttVideoUrl, ttIdentifyAudioBtn, resultEl);
  });
})();
