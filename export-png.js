const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function exportIcons() {
  const publicDir = path.join(__dirname, 'public');
  
  // Export favicon.png (32x32)
  await sharp(path.join(publicDir, 'logo-icon.svg'))
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));
    
  console.log('Successfully generated favicon.png');
}

exportIcons().catch(err => {
  console.error('Error exporting icons:', err);
});
