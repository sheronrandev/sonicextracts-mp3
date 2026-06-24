/**
 * TikTok Video Downloader Module
 * Handles URL detection, metadata fetching, and video download (with/without watermark).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Detect if a URL is a TikTok video URL.
 */
function isTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    return host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
  } catch {
    return false;
  }
}

/**
 * Fetch metadata for a TikTok video.
 * Returns: { title, thumbnail, uploader, caption, duration, duration_string, like_count, view_count, formats }
 */
function fetchTikTokInfo(videoUrl) {
  return new Promise((resolve, reject) => {
    const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', videoUrl]);
    let output = '';
    let stderr = '';

    ytDlp.stdout.on('data', (data) => output += data.toString());
    ytDlp.stderr.on('data', (data) => stderr += data.toString());

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        if (stderr.includes('private') || stderr.includes('Private') || stderr.includes('removed')) {
          return reject(new Error('This TikTok video is private or has been removed.'));
        }
        if (stderr.includes('not exist') || stderr.includes('404')) {
          return reject(new Error('This TikTok video does not exist or has been deleted.'));
        }
        return reject(new Error('Failed to fetch TikTok video. Ensure the URL is a valid public TikTok video.'));
      }

      try {
        const info = JSON.parse(output);
        const duration = info.duration || 0;

        // Check for watermark-free format availability
        // yt-dlp typically provides formats with different IDs:
        // - 'download_addr' or similar: with watermark
        // - 'play_addr' or higher quality: without watermark
        const hasWatermarkFree = info.formats && info.formats.some(f =>
          f.format_note && !f.format_note.toLowerCase().includes('watermark')
        );

        let caption = info.description || info.title || '';
        if (caption.length > 120) {
          caption = caption.substring(0, 117) + '...';
        }

        resolve({
          title: info.title || caption || 'TikTok Video',
          thumbnail: info.thumbnail || '',
          uploader: info.uploader || info.creator || info.channel || 'Unknown',
          caption: caption,
          duration: duration,
          duration_string: info.duration_string || formatDuration(duration),
          like_count: info.like_count || null,
          view_count: info.view_count || null,
          has_watermark_free: hasWatermarkFree
        });
      } catch (e) {
        reject(new Error('Failed to parse TikTok video metadata.'));
      }
    });
  });
}

/**
 * Download a TikTok video, optionally without watermark.
 * @param {string} videoUrl - TikTok video URL
 * @param {boolean} withWatermark - If true, download with watermark; if false, attempt watermark-free
 * @param {string} jobDir - Output directory
 * @param {Function} onProgress - Progress callback
 */
function downloadTikTokVideo(videoUrl, withWatermark, jobDir, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '--merge-output-format', 'mp4',
      '--embed-metadata',
      '--no-playlist',
      '-o', `${jobDir}/%(title)s.%(ext)s`
    ];

    if (!withWatermark) {
      // Try to get the best quality without watermark
      // yt-dlp for TikTok: use format sorting to prefer non-watermarked versions
      args.push('-f', 'best[format_note!=watermarked]/best');
    }

    args.push(videoUrl);

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
        console.error(`TikTok yt-dlp stderr: ${text}`);
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to download TikTok video.'));
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
  isTikTokUrl,
  fetchTikTokInfo,
  downloadTikTokVideo
};
