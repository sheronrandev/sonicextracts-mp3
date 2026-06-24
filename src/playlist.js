/**
 * Playlist Processing Engine
 * Handles fetching playlist metadata, sequential track downloading,
 * and SSE progress broadcasting.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PLAYLIST_CAP = 50;

/**
 * Fetch metadata for all tracks in a YouTube playlist.
 * Returns an array of { id, title, thumbnail, duration_string, url, index }.
 * Capped at PLAYLIST_CAP tracks.
 */
function fetchPlaylistInfo(playlistUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--dump-json',
      '--playlist-end', String(PLAYLIST_CAP),
      playlistUrl
    ];

    const ytDlp = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    ytDlp.stdout.on('data', (data) => { stdout += data.toString(); });
    ytDlp.stderr.on('data', (data) => { stderr += data.toString(); });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to fetch playlist info. Ensure the URL is a valid public playlist.'));
      }

      try {
        // yt-dlp outputs one JSON object per line for --flat-playlist
        const lines = stdout.trim().split('\n').filter(Boolean);
        const tracks = lines.map((line, i) => {
          const info = JSON.parse(line);
          return {
            id: info.id,
            title: info.title || `Track ${i + 1}`,
            thumbnail: info.thumbnails
              ? info.thumbnails[info.thumbnails.length - 1]?.url
              : (info.thumbnail || ''),
            duration_string: info.duration_string || '',
            duration: info.duration || 0,
            url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
            index: i
          };
        });

        resolve({
          tracks,
          total: lines.length,
          capped: lines.length >= PLAYLIST_CAP
        });
      } catch (e) {
        reject(new Error('Failed to parse playlist metadata.'));
      }
    });
  });
}

/**
 * Download and convert a single track to MP3.
 * Emits progress via the `onProgress` callback.
 * Returns the filename of the resulting MP3.
 */
function downloadSingleTrack(videoUrl, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    const ytDlp = spawn('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-thumbnail',
      '--embed-metadata',
      '--convert-thumbnails', 'jpg',
      '--no-playlist',
      '-o', `${outputDir}/%(title)s.%(ext)s`,
      videoUrl
    ]);

    ytDlp.stdout.on('data', (data) => {
      const text = data.toString();

      if (text.includes('[download]') && text.includes('%')) {
        const match = text.match(/(\d+\.?\d*)%/);
        if (match) {
          onProgress({ status: 'downloading', progress: parseFloat(match[1]) });
        }
      } else if (text.includes('[ExtractAudio]') || text.includes('[Merger]') || text.includes('[EmbedThumbnail]')) {
        onProgress({ status: 'converting' });
      }
    });

    ytDlp.stderr.on('data', (data) => {
      // yt-dlp writes some info to stderr; typically non-fatal
      const text = data.toString();
      if (text.includes('ERROR')) {
        console.error(`yt-dlp stderr: ${text}`);
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('yt-dlp exited with error'));
      }

      // Find the generated MP3 file
      try {
        const files = fs.readdirSync(outputDir);
        const mp3 = files.find(f => f.endsWith('.mp3'));
        if (mp3) {
          resolve(mp3);
        } else {
          reject(new Error('MP3 file not found after conversion'));
        }
      } catch (e) {
        reject(new Error('Failed to read output directory'));
      }
    });
  });
}

/**
 * Process an entire playlist sequentially.
 * Broadcasts SSE events for each track via `sendSSE(data)`.
 * Returns an array of { index, title, filename, status } for all tracks.
 *
 * @param {Array} selectedTracks - Array of track objects with { id, title, url, index }
 * @param {string} jobDir - Path to the job's temp directory
 * @param {Function} sendSSE - Function to push SSE data to the client
 */
async function processPlaylist(selectedTracks, jobDir, sendSSE) {
  const total = selectedTracks.length;
  const results = [];
  let completed = 0;

  for (let i = 0; i < selectedTracks.length; i++) {
    const track = selectedTracks[i];
    const trackIndex = track.index;

    // Each track gets its own subdirectory to avoid filename collisions
    const trackDir = path.join(jobDir, `track_${trackIndex}`);
    if (!fs.existsSync(trackDir)) fs.mkdirSync(trackDir, { recursive: true });

    sendSSE({
      type: 'track_progress',
      track: trackIndex,
      status: 'downloading',
      progress: 0,
      completed,
      total
    });

    try {
      const filename = await downloadSingleTrack(
        `https://www.youtube.com/watch?v=${track.id}`,
        trackDir,
        (progress) => {
          sendSSE({
            type: 'track_progress',
            track: trackIndex,
            status: progress.status,
            progress: progress.progress || 0,
            completed,
            total
          });
        }
      );

      completed++;
      results.push({
        index: trackIndex,
        title: track.title,
        filename,
        filePath: path.join(trackDir, filename),
        status: 'done'
      });

      sendSSE({
        type: 'track_progress',
        track: trackIndex,
        status: 'done',
        completed,
        total
      });

    } catch (err) {
      completed++;
      results.push({
        index: trackIndex,
        title: track.title,
        filename: null,
        filePath: null,
        status: 'failed',
        error: err.message
      });

      sendSSE({
        type: 'track_progress',
        track: trackIndex,
        status: 'failed',
        error: err.message,
        completed,
        total
      });
    }
  }

  return results;
}

/**
 * Detect if a URL is a YouTube playlist.
 */
function isPlaylistUrl(url) {
  try {
    const parsed = new URL(url);
    // YouTube playlist URL patterns
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      // Direct playlist page
      if (parsed.pathname === '/playlist' && parsed.searchParams.has('list')) {
        return true;
      }
      // Video URL with playlist context (has both v= and list=)
      if (parsed.searchParams.has('list') && parsed.searchParams.get('list').startsWith('PL')) {
        return true;
      }
      // Any list= parameter that starts with PL (public playlist) or OL (auto-generated)
      if (parsed.searchParams.has('list')) {
        const listId = parsed.searchParams.get('list');
        return listId.startsWith('PL') || listId.startsWith('OL') || listId.startsWith('UU') || listId.startsWith('FL');
      }
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = {
  fetchPlaylistInfo,
  downloadSingleTrack,
  processPlaylist,
  isPlaylistUrl,
  PLAYLIST_CAP
};
