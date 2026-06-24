/**
 * Instagram Video & Reel Downloader Module
 * Handles URL detection, metadata fetching, and video download for Instagram.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Detect if a URL is an Instagram video/reel URL.
 */
function isInstagramUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (host !== 'instagram.com') return false;

    const p = parsed.pathname;
    return p.startsWith('/p/') || p.startsWith('/reel/') || p.startsWith('/tv/') || p.startsWith('/reels/');
  } catch {
    return false;
  }
}

/**
 * Check if the URL looks like an Instagram Story.
 */
function isStoryUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith('/stories/');
  } catch {
    return false;
  }
}

/**
 * Fetch metadata for an Instagram video/reel.
 * Returns: { title, thumbnail, uploader, caption, duration, duration_string }
 */
function fetchInstagramInfo(videoUrl) {
  return new Promise((resolve, reject) => {
    // Check for stories first
    if (isStoryUrl(videoUrl)) {
      return reject(new Error('Instagram Stories cannot be downloaded without login. Only public posts, reels, and IGTV are supported.'));
    }

    const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', videoUrl]);
    let output = '';
    let stderr = '';

    ytDlp.stdout.on('data', (data) => output += data.toString());
    ytDlp.stderr.on('data', (data) => stderr += data.toString());

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        if (stderr.includes('login') || stderr.includes('Login') || stderr.includes('authentication')) {
          return reject(new Error('This content requires Instagram login. Only public posts can be downloaded.'));
        }
        if (stderr.includes('private') || stderr.includes('Private')) {
          return reject(new Error('This account is private. Only public posts can be downloaded.'));
        }
        if (stderr.includes('not exist') || stderr.includes('404') || stderr.includes('Unavailable')) {
          return reject(new Error('This post has been deleted or does not exist.'));
        }
        return reject(new Error('Failed to fetch Instagram content. Ensure the URL is a valid public post, reel, or IGTV.'));
      }

      try {
        const info = JSON.parse(output);
        const duration = info.duration || 0;

        // Truncate caption to 120 chars
        let caption = info.description || info.title || '';
        if (caption.length > 120) {
          caption = caption.substring(0, 117) + '...';
        }

        resolve({
          title: info.title || caption || 'Instagram Video',
          thumbnail: info.thumbnail || '',
          uploader: info.uploader || info.channel || info.uploader_id || 'Unknown',
          caption: caption,
          duration: duration,
          duration_string: info.duration_string || formatDuration(duration)
        });
      } catch (e) {
        reject(new Error('Failed to parse Instagram metadata.'));
      }
    });
  });
}

/**
 * Download an Instagram video/reel as MP4.
 * Instagram typically offers one quality, so no format/quality selection needed.
 */
function downloadInstagramVideo(videoUrl, jobDir, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '--merge-output-format', 'mp4',
      '--embed-metadata',
      '--no-playlist',
      '-o', `${jobDir}/%(title)s.%(ext)s`,
      videoUrl
    ];

    const ytDlp = spawn('yt-dlp', args);

    ytDlp.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('[download]') && text.includes('%')) {
        const match = text.match(/(\d+\.?\d*)%/);
        if (match) {
          onProgress({ status: 'downloading', progress: parseFloat(match[1]) });
        }
      } else if (text.includes('[Merger]') || text.includes('[FFmpegMetadata]')) {
        onProgress({ status: 'processing' });
      }
    });

    ytDlp.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('ERROR')) {
        console.error(`Instagram yt-dlp stderr: ${text}`);
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to download Instagram video.'));
      }

      try {
        const files = fs.readdirSync(jobDir);
        const videoFile = files.find(f =>
          !f.endsWith('.part') && !f.endsWith('.ytdl') &&
          !f.endsWith('.jpg') && !f.endsWith('.webp') &&
          (f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'))
        );

        if (videoFile) {
          resolve(videoFile);
        } else {
          reject(new Error('Video file not found after download.'));
        }
      } catch (e) {
        reject(new Error('Failed to read output directory.'));
      }
    });
  });
}

/**
 * Format seconds to mm:ss or hh:mm:ss string.
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = {
  isInstagramUrl,
  fetchInstagramInfo,
  downloadInstagramVideo
};
