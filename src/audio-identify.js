/**
 * Audio Identification Module
 * Uses AudD API to fingerprint audio from video URLs.
 * Shared across Facebook, Instagram, and TikTok tabs.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

/**
 * Identify audio from a video URL using AudD API.
 * 1. Downloads first 15 seconds of audio via yt-dlp
 * 2. Sends to AudD API for fingerprinting
 * 3. Fetches album art from iTunes Search API
 * 4. Returns structured result
 *
 * @param {string} videoUrl - URL of the video to identify audio from
 * @param {string} tempDir - Temporary directory for audio files
 * @returns {Object} - { found, title, artist, album, year, albumArt, links }
 */
async function identifyAudio(videoUrl, tempDir) {
  const apiKey = process.env.AUDD_API_KEY;
  if (!apiKey) {
    throw new Error('AudD API key not configured. Add AUDD_API_KEY to your .env file.');
  }

  const audioId = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const audioPath = path.join(tempDir, `${audioId}.mp3`);

  try {
    // Step 1: Download first 15 seconds of audio
    await downloadAudioSnippet(videoUrl, audioPath);

    // Step 2: Send to AudD API
    const auddResult = await queryAudD(audioPath, apiKey);

    // Clean up temp file
    try { fs.unlinkSync(audioPath); } catch {}

    if (!auddResult || auddResult.status !== 'success' || !auddResult.result) {
      return { found: false, message: 'Original audio — no match found' };
    }

    const result = auddResult.result;

    // Step 3: Fetch album art from iTunes
    let albumArt = '';
    try {
      albumArt = await fetchAlbumArt(result.title, result.artist);
    } catch {}

    // Step 4: Build streaming links
    const links = {};
    if (result.spotify) {
      links.spotify = result.spotify.external_urls?.spotify || '';
    }
    if (result.apple_music) {
      links.appleMusic = result.apple_music.url || '';
    }
    // Build YouTube Music search link
    if (result.title && result.artist) {
      links.youtubeMusic = `https://music.youtube.com/search?q=${encodeURIComponent(`${result.title} ${result.artist}`)}`;
    }

    return {
      found: true,
      title: result.title || 'Unknown Title',
      artist: result.artist || 'Unknown Artist',
      album: result.album || '',
      year: result.release_date ? result.release_date.substring(0, 4) : '',
      albumArt: albumArt,
      links: links
    };
  } catch (err) {
    // Clean up on error
    try { fs.unlinkSync(audioPath); } catch {}
    throw err;
  }
}

/**
 * Download first 15 seconds of audio from a video URL.
 */
function downloadAudioSnippet(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--postprocessor-args', 'ffmpeg:-t 15',
      '--no-playlist',
      '-o', outputPath,
      videoUrl
    ];

    const ytDlp = spawn('yt-dlp', args);
    let stderr = '';

    ytDlp.stderr.on('data', (data) => { stderr += data.toString(); });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to extract audio snippet for identification.'));
      }

      // yt-dlp may add extension, find the actual file
      const dir = path.dirname(outputPath);
      const base = path.basename(outputPath, '.mp3');
      const files = fs.readdirSync(dir);
      const audioFile = files.find(f => f.startsWith(base) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav')));

      if (audioFile) {
        const actualPath = path.join(dir, audioFile);
        if (actualPath !== outputPath) {
          fs.renameSync(actualPath, outputPath);
        }
        resolve(outputPath);
      } else {
        reject(new Error('Audio snippet file not found after extraction.'));
      }
    });
  });
}

/**
 * Query AudD API with an audio file.
 */
function queryAudD(audioPath, apiKey) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(audioPath);
    const boundary = '----AudDBoundary' + Date.now();

    let body = '';
    body += `--${boundary}\r\n`;
    body += 'Content-Disposition: form-data; name="api_token"\r\n\r\n';
    body += `${apiKey}\r\n`;
    body += `--${boundary}\r\n`;
    body += 'Content-Disposition: form-data; name="return"\r\n\r\n';
    body += 'spotify,apple_music\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n`;
    body += 'Content-Type: audio/mpeg\r\n\r\n';

    const bodyStart = Buffer.from(body, 'utf-8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const payload = Buffer.concat([bodyStart, fileData, bodyEnd]);

    const options = {
      hostname: 'api.audd.io',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Failed to parse AudD API response.'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`AudD API request failed: ${err.message}`));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Fetch album art from iTunes Search API (no auth required).
 */
function fetchAlbumArt(title, artist) {
  return new Promise((resolve, reject) => {
    const query = encodeURIComponent(`${title} ${artist}`);
    const url = `https://itunes.apple.com/search?term=${query}&media=music&limit=1`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.results && parsed.results.length > 0) {
            // Get highest resolution artwork (replace 100x100 with 600x600)
            const artwork = parsed.results[0].artworkUrl100;
            resolve(artwork ? artwork.replace('100x100bb', '600x600bb') : '');
          } else {
            resolve('');
          }
        } catch {
          resolve('');
        }
      });
    }).on('error', () => resolve(''));
  });
}

module.exports = {
  identifyAudio
};
