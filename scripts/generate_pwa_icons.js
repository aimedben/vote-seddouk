import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const publicDir = path.resolve('public');

// Beautiful institutional SVG emblem for Seddouk Elections 2026
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#174B3A" />
      <stop offset="100%" stop-color="#0D2E23" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.3" />
    </filter>
  </defs>

  <!-- Background rounded box -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)" />

  <!-- Subtle Algeria Crescent & Star watermark in background -->
  <g opacity="0.12">
    <circle cx="256" cy="256" r="160" fill="none" stroke="#FFFFFF" stroke-width="6" />
  </g>

  <!-- Ballot Box & Vote Emblem -->
  <g filter="url(#shadow)">
    <!-- Ballot slot base -->
    <path d="M128 240 L384 240 L360 416 L152 416 Z" fill="#FFFFFF" fill-opacity="0.95" />
    <path d="M116 224 L396 224 L396 248 L116 248 Z" fill="url(#goldGrad)" rx="6" />

    <!-- Ballot Paper Entering the Urn -->
    <rect x="180" y="100" width="152" height="150" rx="14" fill="#FFFFFF" stroke="#E2E8E3" stroke-width="4" />
    
    <!-- Ballot Header & Checkmark inside Paper -->
    <rect x="200" y="122" width="112" height="12" rx="4" fill="#174B3A" />
    <path d="M214 175 L238 200 L298 142" fill="none" stroke="#174B3A" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Front Badge Stamp -->
    <circle cx="256" cy="328" r="42" fill="#174B3A" />
    <circle cx="256" cy="328" r="36" fill="none" stroke="url(#goldGrad)" stroke-width="3" />
    <text x="256" y="324" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="900" fill="#FFFFFF" letter-spacing="1">SEDDOUK</text>
    <text x="256" y="342" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="url(#goldGrad)">2026</text>
  </g>

  <!-- Institutional Tagline at bottom -->
  <text x="256" y="468" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="800" fill="#FFFFFF" letter-spacing="2" opacity="0.9">ELECTIONS LOCALES</text>
</svg>`;

// Maskable icon with safe zone padding (central 80%)
const svgMaskableContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#174B3A" />
      <stop offset="100%" stop-color="#0D2E23" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
  </defs>

  <!-- Full bleed background for Android adaptive icon crop -->
  <rect width="512" height="512" fill="url(#bgGrad)" />

  <!-- Scaled content centered within 70% safe zone -->
  <g transform="translate(76, 76) scale(0.7)">
    <!-- Ballot slot base -->
    <path d="M128 240 L384 240 L360 416 L152 416 Z" fill="#FFFFFF" fill-opacity="0.95" />
    <path d="M116 224 L396 224 L396 248 L116 248 Z" fill="url(#goldGrad)" rx="6" />

    <!-- Ballot Paper Entering Urn -->
    <rect x="180" y="100" width="152" height="150" rx="14" fill="#FFFFFF" stroke="#E2E8E3" stroke-width="4" />
    <rect x="200" y="122" width="112" height="12" rx="4" fill="#174B3A" />
    <path d="M214 175 L238 200 L298 142" fill="none" stroke="#174B3A" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Badge -->
    <circle cx="256" cy="328" r="44" fill="#174B3A" />
    <circle cx="256" cy="328" r="38" fill="none" stroke="url(#goldGrad)" stroke-width="3" />
    <text x="256" y="324" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="900" fill="#FFFFFF" letter-spacing="1">SEDDOUK</text>
    <text x="256" y="342" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="url(#goldGrad)">2026</text>
  </g>
</svg>`;

async function run() {
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent);
  console.log('Written icon.svg');

  const svgBuffer = Buffer.from(svgContent);
  const svgMaskableBuffer = Buffer.from(svgMaskableContent);

  // 192x192
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));
  console.log('Generated pwa-192x192.png');

  // 512x512
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));
  console.log('Generated pwa-512x512.png');

  // 512x512 maskable
  await sharp(svgMaskableBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
  console.log('Generated pwa-maskable-512x512.png');

  // 180x180 apple-touch-icon
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  // favicon
  await sharp(svgBuffer)
    .resize(64, 64)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));
  console.log('Generated favicon.png');
}

run().catch(console.error);
