# SonicExtract — Social Media Media Downloader

SonicExtract is a high-performance web-based media downloader supporting YouTube, Facebook, Instagram, and TikTok, powered by `yt-dlp` and `ffmpeg` with studio-grade frequency isolation and audio identification capabilities.

## Requirements

Ensure that you have the following tools installed and available in your system's PATH:
- **Node.js** (v18+)
- **yt-dlp** (Ensure it is updated to the latest version to prevent platform-specific breaking changes)
- **ffmpeg** (Used for merging video/audio streams and extraction)

## Installation & Setup

1. Clone the repository and navigate to the project directory:
   ```bash
   cd yt-mp3
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory (if not already present):
   ```env
   PORT=3000
   MAX_DURATION_SECONDS=600
   AUDD_API_KEY=your_audd_api_key_here
   ```

4. Start the application:
   ```bash
   npm start
   ```
   Or run in development mode:
   ```bash
   npm run dev
   ```

## Audio Identification Configuration

SonicExtract features a unified **Identify Audio** tool for Facebook, Instagram, and TikTok media.
- Sign up at [audd.io](https://audd.io/) to get a free API key (provides 300 requests/day).
- Add the key to your `.env` file under `AUDD_API_KEY`.
- The service downloads the first 15 seconds of the video, fingerprints it, queries AudD, and returns metadata including album art and direct streaming links (Spotify, Apple Music, YouTube Music).

## Supported Platforms & Known Limitations

### 1. YouTube
- **Capabilities**: Extract audio as MP3, AAC, FLAC, WAV, OGG in multiple bitrates. Download video in MP4/WEBM formats up to 4K. Full playlist batch downloads (ZIP or individual).
- **Limitations**: Restricted or private content cannot be accessed. Playlists are capped at 50 tracks.

### 2. Facebook
- **Capabilities**: Download public video URLs (from pages or profiles) in MP4 H.264 or H.265. Identify video audio tracks.
- **Limitations**: Private videos, stories, and videos requiring a Facebook account login cannot be downloaded. Audio extraction is not offered due to licensing restrictions (use the Audio Identifier instead).

### 3. Instagram
- **Capabilities**: Download public Reels, Posts, and IGTV videos in MP4 format. Identify video audio tracks.
- **Limitations**: Stories cannot be downloaded (as they require login session tokens). Reels/Posts from private accounts are not supported.

### 4. TikTok
- **Capabilities**: Download videos either **with** or **without watermark** (by instructing `yt-dlp` to prioritize clean streams). Identify video audio tracks.
- **Limitations**: Deleted, private, or age-restricted videos cannot be downloaded.
