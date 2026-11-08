import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = 'public/candidates';
const ffsPoster = 'public/assets/aistudio/66a79ef1-5dc2-4841-b3bb-a9fe24121a26_b80d2264.jpg';

async function cropFFS() {
  console.log('Recropping FFS candidates 1 to 26 with verified coordinates...');

  const ffsRows = [
    { y: 288, count: 7, candidates: [7, 6, 5, 4, 3, 2, 1], xStart: 76, xGap: 141 },
    { y: 520, count: 7, candidates: [14, 13, 12, 11, 10, 9, 8], xStart: 76, xGap: 141 },
    { y: 750, count: 7, candidates: [21, 20, 19, 18, 17, 16, 15], xStart: 76, xGap: 141 },
    { y: 980, count: 5, candidates: [26, 25, 24, 23, 22], xStart: 217, xGap: 141 },
  ];

  for (const row of ffsRows) {
    for (let i = 0; i < row.count; i++) {
      const num = row.candidates[i];
      const left = Math.round(row.xStart + i * row.xGap);
      const targetFile = path.join(outDir, `ffs_${num}.jpg`);

      try {
        await sharp(ffsPoster)
          .extract({
            left: Math.max(0, left),
            top: row.y,
            width: 130,
            height: 180,
          })
          .toFile(targetFile);
        console.log(`Successfully generated ffs_${num}.jpg at y=${row.y}, left=${left}`);
      } catch (e) {
        console.error(`Error for FFS ${num}:`, e.message);
      }
    }
  }

  // Clean up any temporary test files
  const files = fs.readdirSync(outDir);
  for (const f of files) {
    if (f.startsWith('test_')) {
      try {
        fs.unlinkSync(path.join(outDir, f));
      } catch (err) {}
    }
  }

  console.log('All FFS candidates successfully updated!');
}

cropFFS();
