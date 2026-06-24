/**
 * Facebook Video Downloader Module
 * Handles URL detection, metadata fetching, and video download for Facebook.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Detect if a URL is a Facebook video URL.
 */
function isFacebookUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '').replace('m.', '');
    return host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com';
  } catch {
    return false;
  }
}

/**
 * Fetch metadata for a Facebook video.
 * Returns: { title, thumbnail, uploader, duration, duration_string, video_formats }
 */
function fetchFacebookInfo(videoUrl) {
  return new Promise((resolve, reject) => {
    const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', videoUrl]);
    let output = '';
    let stderr = '';

    ytDlp.stdout.on('data', (data) => output += data.toString());
    ytDlp.stderr.on('data', (data) => stderr += data.toString());

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        // Provide specific error messages
        if (stderr.includes('login') || stderr.includes('Login')) {
          return reject(new Error('This video requires Facebook login and cannot be downloaded.'));
        }
        if (stderr.includes('private') || stderr.includes('Private')) {
          return reject(new Error('This video is private and cannot be accessed.'));
        }
        if (stderr.includes('geo') || stderr.includes('not available in your')) {
          return reject(new Error('This video is geo-blocked and not available in your region.'));
        }
        return reject(new Error('Failed to fetch Facebook video. Ensure the URL is a valid public Facebook video.'));
      }

      try {
        const info = JSON.parse(output);
        const duration = info.duration || 0;

        // Build video quality list — only H.264 and H.265 MP4 formats
        const video_formats = [];
        const seenHeights = new Set();
        const videoFormats = info.formats
          .filter(f => f.vcodec !== 'none' && f.height && f.ext === 'mp4')
          .sort((a, b) => b.height - a.height);

        for (const f of videoFormats) {
          if (seenHeights.has(f.height)) continue;
          seenHeights.add(f.height);

          let size = 0;
          let isEstimate = false;

          if (f.filesize) {
            size = f.filesize;
          } else if (f.filesize_approx) {
            size = Math.round(f.filesize_approx * 0.88);
            isEstimate = true;
          } else if (f.tbr && duration > 0) {
            size = Math.round((f.tbr * 1000 / 8) * duration * 0.88);
            isEstimate = true;
          }

          video_formats.push({
            height: f.height,
            size: size,
            isEstimate: isEstimate || size === 0,
            codec: f.vcodec ? (f.vcodec.includes('h265') || f.vcodec.includes('hevc') ? 'H.265' : 'H.264') : 'H.264'
          });
        }

        resolve({
          title: info.title || 'Facebook Video',
          thumbnail: info.thumbnail || '',
          uploader: info.uploader || info.channel || 'Unknown',
          duration: duration,
          duration_string: info.duration_string || formatDuration(duration),
          video_formats: video_formats
        });
      } catch (e) {
        reject(new Error('Failed to parse Facebook video metadata.'));
      }
    });
  });
}

/**
 * Download a Facebook video.
 * Returns the filename of the downloaded file.
 */
function downloadFacebookVideo(videoUrl, format, quality, jobDir, onProgress) {
  return new Promise((resolve, reject) => {
    const height = quality.replace('p', '');
    let formatArgs;

    if (format.toLowerCase().includes('h.265') || format.toLowerCase().includes('hevc')) {
      formatArgs = ['-S', `vcodec:h265,res:${height},ext:mp4:m4a`, '--merge-output-format', 'mp4'];
    } else {
      formatArgs = ['-S', `vcodec:h264,res:${height},ext:mp4:m4a`, '--merge-output-format', 'mp4'];
    }

    const args = [
      ...formatArgs,
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
        console.error(`Facebook yt-dlp stderr: ${text}`);
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to download Facebook video.'));
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
  isFacebookUrl,
  fetchFacebookInfo,
  downloadFacebookVideo
};
