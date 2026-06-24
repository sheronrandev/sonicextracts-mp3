const cp = require('child_process');
const fs = require('fs');
const out = cp.execSync('yt-dlp --dump-json --no-playlist "https://www.youtube.com/watch?v=jNQXAC9IVRw"');
const info = JSON.parse(out);

const bestAudio = info.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none').sort((a,b) => (b.filesize || b.filesize_approx) - (a.filesize || a.filesize_approx))[0];
const audioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0;

const videoFormats = info.formats.filter(f => f.vcodec !== 'none' && f.height).map(f => ({
  height: f.height,
  ext: f.ext,
  vcodec: f.vcodec,
  size: f.filesize || f.filesize_approx,
  totalSizeApprox: (f.filesize || f.filesize_approx || 0) + audioSize
}));

fs.writeFileSync('vformats.json', JSON.stringify({videoFormats, audioSize}, null, 2));
