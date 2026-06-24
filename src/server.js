require('dotenv').config();
const express = require('express');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const { fetchPlaylistInfo, processPlaylist, isPlaylistUrl, PLAYLIST_CAP } = require('./playlist');
const { isFacebookUrl, fetchFacebookInfo, downloadFacebookVideo } = require('./facebook');
const { isInstagramUrl, fetchInstagramInfo, downloadInstagramVideo } = require('./instagram');
const { isTikTokUrl, fetchTikTokInfo, downloadTikTokVideo } = require('./tiktok');
const { identifyAudio } = require('./audio-identify');

try {
  execSync('yt-dlp --version');
  execSync('ffmpeg -version');
} catch (error) {
  console.error("CRITICAL ERROR: yt-dlp or ffmpeg is not installed or not in PATH.");
  console.error("Please install them to use this application.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, '../temp');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Configure rate limiting middleware for API routes to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in standard headers
  legacyHeaders: false, // Disable legacy headers
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

app.use('/api/', apiLimiter);

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Cleanup old temp folders every hour
setInterval(() => {
  if (!fs.existsSync(TEMP_DIR)) return;
  const now = Date.now();
  fs.readdir(TEMP_DIR, (err, folders) => {
    if (err) return;
    folders.forEach(folder => {
      const folderPath = path.join(TEMP_DIR, folder);
      fs.stat(folderPath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > 3600000) {
          fs.rm(folderPath, { recursive: true, force: true }, () => {});
        }
      });
    });
  });
}, 3600000);

// SSE clients map (for single-video downloads)
const clients = new Map();
// SSE clients map (for playlist downloads)
const playlistClients = new Map();
// SSE clients map (for social media platform downloads)
const socialClients = new Map();

// ═══════════════════════════════════════════════════════════════
// SINGLE VIDEO ENDPOINTS (existing, untouched logic)
// ═══════════════════════════════════════════════════════════════

app.get('/api/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

  res.setHeader('Cache-Control', 'no-store');

  const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', videoUrl]);
  let output = '';

  ytDlp.stdout.on('data', (data) => output += data.toString());

  ytDlp.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Failed to fetch video. Ensure the URL is valid and public.' });
    }
    try {
      const info = JSON.parse(output);
      const maxDuration = parseInt(process.env.MAX_DURATION_SECONDS) || 600;
      
      const duration = info.duration || 0; // seconds

      // Correction factor for bitrate-based estimates (filesize_approx, tbr).
      // Declared bitrates are ceiling values; real encoded sizes are ~12% lower.
      const APPROX_CORRECTION = 0.88;

      // ── Find audio stream closest to 140kbps (matches yt-dlp's typical bestaudio merge) ──
      const TARGET_AUDIO_ABR = 140;
      const audioOnlyStreams = info.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
      const mergeAudio = audioOnlyStreams
        .sort((a, b) => Math.abs((a.abr || 0) - TARGET_AUDIO_ABR) - Math.abs((b.abr || 0) - TARGET_AUDIO_ABR))[0];

      // Also keep track of the highest-bitrate audio for the audio_info response
      const bestAudio = audioOnlyStreams
        .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];

      // Get merge-audio stream size for video estimates
      let audioSize = 0;
      let audioSizeIsEstimate = false;
      if (mergeAudio) {
        if (mergeAudio.filesize) {
          audioSize = mergeAudio.filesize; // exact — no correction
        } else if (mergeAudio.filesize_approx) {
          audioSize = mergeAudio.filesize_approx * APPROX_CORRECTION;
          audioSizeIsEstimate = true;
        } else if ((mergeAudio.abr || mergeAudio.tbr) && duration > 0) {
          const audioBitrate = mergeAudio.abr || mergeAudio.tbr; // kbps
          audioSize = (audioBitrate * 1000 / 8) * duration * APPROX_CORRECTION;
          audioSizeIsEstimate = true;
        }
      }

      // ── Build video quality list with corrected sizes ──
      const video_formats = [];
      const seenHeights = new Set();
      const videoOnlyFormats = info.formats
        .filter(f => f.vcodec !== 'none' && f.height)
        .sort((a, b) => b.height - a.height);

      for (const f of videoOnlyFormats) {
        if (seenHeights.has(f.height)) continue;
        seenHeights.add(f.height);

        // For each resolution, find the format with the best size data
        const formatsAtHeight = videoOnlyFormats.filter(vf => vf.height === f.height);

        // Prefer formats that have exact filesize, then filesize_approx, then any
        const withExact = formatsAtHeight.filter(vf => vf.filesize);
        const withApprox = formatsAtHeight.filter(vf => vf.filesize_approx);
        const bestForSize = withExact.length > 0
          ? withExact.sort((a, b) => b.filesize - a.filesize)[0]
          : withApprox.length > 0
            ? withApprox.sort((a, b) => b.filesize_approx - a.filesize_approx)[0]
            : formatsAtHeight[0]; // fallback to first if none have size data

        let videoSize = 0;
        let isEstimate = audioSizeIsEstimate; // inherit audio estimate flag

        if (bestForSize.filesize) {
          videoSize = bestForSize.filesize; // exact — no correction
        } else if (bestForSize.filesize_approx) {
          videoSize = bestForSize.filesize_approx * APPROX_CORRECTION;
          isEstimate = true;
        } else if (bestForSize.tbr && duration > 0) {
          videoSize = (bestForSize.tbr * 1000 / 8) * duration * APPROX_CORRECTION;
          isEstimate = true;
        } else {
          isEstimate = true; // no data at all
        }

        // Combined size = video + audio (no container overhead — correction factor covers it)
        const totalSize = videoSize + audioSize;
        const finalSize = totalSize > 0 ? Math.round(totalSize) : 0;

        video_formats.push({
          height: f.height,
          size: finalSize,
          isEstimate: isEstimate || finalSize === 0
        });
      }

      // ── Prepare audio info for frontend audio size estimation ──
      const audioInfo = {
        bestAudioBitrate: bestAudio ? (bestAudio.abr || bestAudio.tbr || 0) : 0,
        duration: duration,
        sampleRate: bestAudio ? (bestAudio.asr || 44100) : 44100
      };

      console.log(`📋 Video info: "${info.title}" — ${video_formats.length} video qualities found`);

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        channel: info.uploader,
        duration: info.duration,
        duration_string: info.duration_string,
        is_long: info.duration > maxDuration,
        video_formats: video_formats,
        audio_info: audioInfo
      });
    } catch (e) {
      console.error('Failed to parse video metadata:', e.message);
      res.status(500).json({ error: 'Failed to parse video metadata.' });
    }
  });
});

app.get('/api/progress', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.set(jobId, res);
  req.on('close', () => clients.delete(jobId));
});

app.post('/api/download', (req, res) => {
  const { url, jobId, type, format, quality } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and Job ID are required' });

  res.json({ message: 'Processing started' });

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

  let args = [];
  if (type === 'audio' && format) {
    args = [
      '-x',
      '--audio-format', format.toLowerCase(),
      '--embed-thumbnail',
      '--embed-metadata',
      '--convert-thumbnails', 'jpg',
      '--no-playlist',
      '-o', `${jobDir}/%(title)s.%(ext)s`
    ];
    if (quality && !['flac', 'wav'].includes(format.toLowerCase())) {
      args.push('--audio-quality', quality.replace('kbps', 'K'));
    }
    args.push(url);
  } else if (type === 'video' && format && quality) {
    const height = quality.replace('p', '');
    let formatArgs = [];
    if (format.toLowerCase() === 'mp4 (h.264)') {
      formatArgs = ['-S', `vcodec:h264,res:${height},ext:mp4:m4a`, '--merge-output-format', 'mp4'];
    } else if (format.toLowerCase() === 'mp4 (h.265/hevc)') {
      formatArgs = ['-S', `vcodec:h265,res:${height},ext:mp4:m4a`, '--merge-output-format', 'mp4'];
    } else if (format.toLowerCase() === 'webm (vp9)') {
      formatArgs = ['-S', `vcodec:vp9,res:${height},ext:webm:webm`, '--merge-output-format', 'webm'];
    } else {
      formatArgs = ['-S', `res:${height}`, '--merge-output-format', 'mkv'];
    }

    args = [
      ...formatArgs,
      '--embed-metadata', // title, channel embedding
      '--no-playlist',
      '-o', `${jobDir}/%(title)s.%(ext)s`,
      url
    ];
  } else {
    // Fallback if missing params
    args = [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--embed-thumbnail', '--embed-metadata', '--convert-thumbnails', 'jpg',
      '--no-playlist', '-o', `${jobDir}/%(title)s.%(ext)s`, url
    ];
  }

  const ytDlp = spawn('yt-dlp', args);

  ytDlp.stdout.on('data', (data) => {
    const text = data.toString();
    const client = clients.get(jobId);
    if (!client) return;

    if (text.includes('[download]') && text.includes('%')) {
      const match = text.match(/(\d+\.?\d*)%/);
      if (match) {
        client.write(`data: ${JSON.stringify({ status: 'downloading', progress: match[1] })}\n\n`);
      }
    } else if (text.includes('[ExtractAudio]') || text.includes('[Merger]')) {
      client.write(`data: ${JSON.stringify({ status: 'converting' })}\n\n`);
    }
  });

  ytDlp.on('close', (code) => {
    const client = clients.get(jobId);
    if (code === 0) {
      fs.readdir(jobDir, (err, files) => {
        const file = files ? files.find(f => !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.jpg') && !f.endsWith('.webp')) : null;
        if (file && client) {
           client.write(`data: ${JSON.stringify({ status: 'ready', file: encodeURIComponent(file) })}\n\n`);
        } else if (client) {
           client.write(`data: ${JSON.stringify({ status: 'error', message: 'File generated but not found.' })}\n\n`);
        }
      });

      // Cleanup: keep only the last 4 completed jobs (excluding this one)
      cleanupTempDir(jobId);
    } else {
      if (client) client.write(`data: ${JSON.stringify({ status: 'error', message: 'Failed to process video (e.g., age restricted or private)' })}\n\n`);
    }
  });
});

// Cleanup helper: keeps the current job + the 3 most recent other jobs (4 total)
function cleanupTempDir(currentJobId) {
  try {
    const folders = fs.readdirSync(TEMP_DIR);
    const folderStats = folders
      .filter(f => f !== currentJobId) // never delete the job we just finished
      .map(folder => {
        const folderPath = path.join(TEMP_DIR, folder);
        try {
          return { name: folder, path: folderPath, mtimeMs: fs.statSync(folderPath).mtimeMs };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Keep the 3 most recent OTHER folders (so 3 + current = 4 total)
    if (folderStats.length > 3) {
      folderStats.slice(3).forEach(f => {
        fs.rm(f.path, { recursive: true, force: true }, () => {
          console.log(`🗑️ Cleaned up old job: ${f.name}`);
        });
      });
    }
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
}

app.get('/api/file', (req, res) => {
  const { jobId, file } = req.query;
  if (!jobId || !file) return res.status(400).send('Invalid request');

  const filePath = path.join(TEMP_DIR, jobId, decodeURIComponent(file));
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, (err) => {
      // Clean up the job folder after download completes
      try {
        fs.rmSync(path.join(TEMP_DIR, jobId), { recursive: true, force: true });
        console.log(`🗑️ Cleaned up downloaded job: ${jobId}`);
      } catch (e) {
        console.error('Failed to clean up job after download:', e.message);
      }
    });
  } else {
    res.status(404).send('File not found or expired');
  }
});

// ═══════════════════════════════════════════════════════════════
// URL TYPE DETECTION ENDPOINT
// ═══════════════════════════════════════════════════════════════

app.get('/api/detect', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  res.json({ isPlaylist: isPlaylistUrl(url) });
});

// ═══════════════════════════════════════════════════════════════
// PLAYLIST ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/playlist/info?url=...
 * Fetches metadata for all tracks in a playlist (capped at 50).
 */
app.get('/api/playlist/info', async (req, res) => {
  const playlistUrl = req.query.url;
  if (!playlistUrl) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await fetchPlaylistInfo(playlistUrl);
    res.json({
      tracks: info.tracks,
      total: info.total,
      capped: info.capped,
      cap: PLAYLIST_CAP
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/playlist/progress?jobId=...
 * SSE endpoint for real-time playlist processing progress.
 */
app.get('/api/playlist/progress', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  playlistClients.set(jobId, res);
  req.on('close', () => playlistClients.delete(jobId));
});

/**
 * POST /api/playlist/download
 * Body: { url, jobId, mode: "zip"|"individual", selectedTracks: [...] }
 * Starts sequential processing of selected playlist tracks.
 */
app.post('/api/playlist/download', async (req, res) => {
  const { url, jobId, mode, selectedTracks } = req.body;

  if (!url || !jobId || !mode || !selectedTracks || !selectedTracks.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (selectedTracks.length > PLAYLIST_CAP) {
    return res.status(400).json({ error: `Maximum ${PLAYLIST_CAP} tracks allowed` });
  }

  // Respond immediately — processing happens in background
  res.json({ message: 'Playlist processing started' });

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  // SSE sender
  function sendSSE(data) {
    const client = playlistClients.get(jobId);
    if (client) {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  try {
    const results = await processPlaylist(selectedTracks, jobDir, sendSSE);

    const successfulTracks = results.filter(r => r.status === 'done');
    const failedCount = results.filter(r => r.status === 'failed').length;

    if (mode === 'zip') {
      // Signal that zipping is starting
      sendSSE({ type: 'status', status: 'zipping' });

      if (successfulTracks.length === 0) {
        sendSSE({ type: 'status', status: 'error', message: 'All tracks failed to download.' });
        cleanupJobDir(jobDir);
        return;
      }

      sendSSE({
        type: 'status',
        status: 'complete',
        mode: 'zip',
        downloadUrl: `/api/playlist/zip?jobId=${jobId}`,
        successCount: successfulTracks.length,
        failedCount
      });

    } else {
      // Individual download mode
      if (successfulTracks.length === 0) {
        sendSSE({ type: 'status', status: 'error', message: 'All tracks failed to download.' });
        cleanupJobDir(jobDir);
        return;
      }

      const files = successfulTracks.map(t => ({
        name: t.filename,
        url: `/api/playlist/file?jobId=${jobId}&track=${t.index}&file=${encodeURIComponent(t.filename)}`
      }));

      sendSSE({
        type: 'status',
        status: 'complete',
        mode: 'individual',
        files,
        successCount: successfulTracks.length,
        failedCount
      });
    }
  } catch (err) {
    sendSSE({ type: 'status', status: 'error', message: err.message });
    cleanupJobDir(jobDir);
  }
});

/**
 * GET /api/playlist/zip?jobId=...
 * Streams a ZIP file containing all successfully downloaded MP3s.
 */
app.get('/api/playlist/zip', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
    return res.status(404).send('Job not found or expired');
  }

  // Collect all MP3 files from track subdirectories
  const mp3Files = [];
  const trackDirs = fs.readdirSync(jobDir).filter(d => d.startsWith('track_'));
  for (const dir of trackDirs) {
    const dirPath = path.join(jobDir, dir);
    const stat = fs.statSync(dirPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.mp3')) {
          mp3Files.push({ path: path.join(dirPath, file), name: file });
        }
      }
    }
  }

  if (mp3Files.length === 0) {
    return res.status(404).send('No MP3 files found');
  }

  // Set response headers for ZIP download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="playlist.zip"');

  // Create archive and pipe directly to response (NO memory buffering)
  const archive = archiver('zip', { zlib: { level: 1 } }); // level 1 = fast compression for already-compressed MP3s
  archive.pipe(res);

  for (const mp3 of mp3Files) {
    archive.file(mp3.path, { name: mp3.name });
  }

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    res.status(500).end();
  });

  // Clean up after the archive is finished and response is sent
  res.on('finish', () => {
    cleanupJobDir(jobDir);
  });

  archive.finalize();
});

/**
 * GET /api/playlist/file?jobId=...&track=...&file=...
 * Serves a single MP3 from the playlist job directory.
 */
app.get('/api/playlist/file', (req, res) => {
  const { jobId, track, file } = req.query;
  if (!jobId || track === undefined || !file) {
    return res.status(400).send('Invalid request');
  }

  const filePath = path.join(TEMP_DIR, jobId, `track_${track}`, decodeURIComponent(file));

  if (fs.existsSync(filePath)) {
    res.download(filePath, decodeURIComponent(file));
  } else {
    res.status(404).send('File not found or expired');
  }
});

/**
 * DELETE /api/playlist/cleanup?jobId=...
 * Client signals it's done downloading all individual files.
 */
app.delete('/api/playlist/cleanup', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  const jobDir = path.join(TEMP_DIR, jobId);
  cleanupJobDir(jobDir);
  res.json({ message: 'Cleaned up' });
});

function cleanupJobDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rm(dirPath, { recursive: true, force: true }, () => {
        console.log(`🗑️ Cleaned up playlist job: ${path.basename(dirPath)}`);
      });
    }
  } catch (e) {
    console.error('Playlist cleanup error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// FACEBOOK ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/facebook/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'URL is required' });
  if (!isFacebookUrl(videoUrl)) return res.status(400).json({ error: 'Not a valid Facebook URL' });

  res.setHeader('Cache-Control', 'no-store');

  fetchFacebookInfo(videoUrl)
    .then(info => {
      console.log(`📋 Facebook video info: "${info.title}" — ${info.video_formats.length} qualities found`);
      res.json(info);
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

app.get('/api/facebook/progress', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  socialClients.set(`fb_${jobId}`, res);
  req.on('close', () => socialClients.delete(`fb_${jobId}`));
});

app.post('/api/facebook/download', (req, res) => {
  const { url, jobId, format, quality } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and Job ID are required' });

  res.json({ message: 'Processing started' });

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

  const sendSSE = (data) => {
    const client = socialClients.get(`fb_${jobId}`);
    if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  downloadFacebookVideo(url, format || 'MP4 (H.264)', quality || '720p', jobDir, (progress) => {
    sendSSE(progress);
  })
    .then(file => {
      sendSSE({ status: 'ready', file: encodeURIComponent(file) });
      cleanupTempDir(jobId);
    })
    .catch(err => {
      sendSSE({ status: 'error', message: err.message });
    });
});

// ═══════════════════════════════════════════════════════════════
// INSTAGRAM ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/instagram/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'URL is required' });
  if (!isInstagramUrl(videoUrl)) return res.status(400).json({ error: 'Not a valid Instagram URL' });

  res.setHeader('Cache-Control', 'no-store');

  fetchInstagramInfo(videoUrl)
    .then(info => {
      console.log(`📋 Instagram info: "${info.title}" by @${info.uploader}`);
      res.json(info);
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

app.get('/api/instagram/progress', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  socialClients.set(`ig_${jobId}`, res);
  req.on('close', () => socialClients.delete(`ig_${jobId}`));
});

app.post('/api/instagram/download', (req, res) => {
  const { url, jobId } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and Job ID are required' });

  res.json({ message: 'Processing started' });

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

  const sendSSE = (data) => {
    const client = socialClients.get(`ig_${jobId}`);
    if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  downloadInstagramVideo(url, jobDir, (progress) => {
    sendSSE(progress);
  })
    .then(file => {
      sendSSE({ status: 'ready', file: encodeURIComponent(file) });
      cleanupTempDir(jobId);
    })
    .catch(err => {
      sendSSE({ status: 'error', message: err.message });
    });
});

// ═══════════════════════════════════════════════════════════════
// TIKTOK ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/tiktok/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'URL is required' });
  if (!isTikTokUrl(videoUrl)) return res.status(400).json({ error: 'Not a valid TikTok URL' });

  res.setHeader('Cache-Control', 'no-store');

  fetchTikTokInfo(videoUrl)
    .then(info => {
      console.log(`📋 TikTok info: "${info.title}" by @${info.uploader}`);
      res.json(info);
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

app.get('/api/tiktok/progress', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).send('Job ID required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  socialClients.set(`tt_${jobId}`, res);
  req.on('close', () => socialClients.delete(`tt_${jobId}`));
});

app.post('/api/tiktok/download', (req, res) => {
  const { url, jobId, watermark } = req.body;
  if (!url || !jobId) return res.status(400).json({ error: 'URL and Job ID are required' });

  res.json({ message: 'Processing started' });

  const jobDir = path.join(TEMP_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

  const withWatermark = watermark !== false; // Default to true if not specified

  const sendSSE = (data) => {
    const client = socialClients.get(`tt_${jobId}`);
    if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  downloadTikTokVideo(url, withWatermark, jobDir, (progress) => {
    sendSSE(progress);
  })
    .then(file => {
      sendSSE({ status: 'ready', file: encodeURIComponent(file) });
      cleanupTempDir(jobId);
    })
    .catch(err => {
      sendSSE({ status: 'error', message: err.message });
    });
});

// ═══════════════════════════════════════════════════════════════
// AUDIO IDENTIFICATION
// ═══════════════════════════════════════════════════════════════

app.post('/api/identify-audio', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const result = await identifyAudio(url, TEMP_DIR);
    console.log(`🎵 Audio identification: ${result.found ? `"${result.title}" by ${result.artist}` : 'No match'}`);
    res.json(result);
  } catch (err) {
    console.error('Audio identification error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PLATFORM DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect which platform a URL belongs to.
 * Returns: 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown'
 */
function detectPlatform(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '').replace('m.', '');

    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com') return 'facebook';
    if (host === 'instagram.com') return 'instagram';
    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return 'tiktok';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

app.get('/api/detect-platform', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  res.json({ platform: detectPlatform(url), isPlaylist: isPlaylistUrl(url) });
});

// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
