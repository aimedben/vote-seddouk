import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = 'public/candidates';
const partyDir = 'public/parties';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(partyDir)) fs.mkdirSync(partyDir, { recursive: true });

async function run() {
  console.log('Starting image extraction...');

  // 1. FLN (1131 x 1600)
  // Poster: public/assets/aistudio/a3f6d9a7-7609-4531-92e9-ba2050230c58_3a067346.jpg
  const flnPoster = 'public/assets/aistudio/a3f6d9a7-7609-4531-92e9-ba2050230c58_3a067346.jpg';
  // Extract FLN party logo (top left 1 FLN + circle logo)
  await sharp(flnPoster)
    .extract({ left: 35, top: 20, width: 220, height: 260 })
    .toFile(path.join(partyDir, 'fln.jpg'));

  // FLN Grid: 4 rows.
  // Row 1: candidates 1 to 7 (left to right: 1, 2, 3, 4, 5, 6, 7)
  // X start ~ 32, spacing ~ 152, width ~ 140, height ~ 180
  // Y row 1: 462
  // Y row 2: 686
  // Y row 3: 910
  // Y row 4: 1134 (candidates 22 to 26: 5 candidates centered or spaced)
  const flnRows = [
    { y: 462, count: 7, startNum: 1, xStart: 32, xGap: 154 },
    { y: 686, count: 7, startNum: 8, xStart: 32, xGap: 154 },
    { y: 910, count: 7, startNum: 15, xStart: 32, xGap: 154 },
    { y: 1134, count: 5, startNum: 22, xStart: 186, xGap: 154 },
  ];

  for (const row of flnRows) {
    for (let i = 0; i < row.count; i++) {
      const num = row.startNum + i;
      const left = Math.round(row.xStart + i * row.xGap);
      try {
        await sharp(flnPoster)
          .extract({ left: Math.max(0, left), top: row.y, width: 140, height: 185 })
          .toFile(path.join(outDir, `fln_${num}.jpg`));
      } catch (e) {
        console.error(`FLN ${num} error:`, e.message);
      }
    }
  }

  // 2. FFS (1129 x 1600)
  // Poster: public/assets/aistudio/66a79ef1-5dc2-4841-b3bb-a9fe24121a26_b80d2264.jpg
  const ffsPoster = 'public/assets/aistudio/66a79ef1-5dc2-4841-b3bb-a9fe24121a26_b80d2264.jpg';
  // FFS Logo (top left "FFS" rose symbol)
  await sharp(ffsPoster)
    .extract({ left: 55, top: 45, width: 145, height: 145 })
    .toFile(path.join(partyDir, 'ffs.jpg'));

  // FFS Grid: Row 1 has candidates 7..1 (from left to right: 7, 6, 5, 4, 3, 2, 1)
  // Row 2: 14..8
  // Row 3: 21..15
  // Row 4: 26..22
  // Let's verify X positions:
  // 7 cols: col 0 is candidate 7, col 6 is candidate 1
  // Col 6 x ~ 920. Col 0 x ~ 75. spacing ~ 141.
  const ffsRows = [
    { y: 288, count: 7, candidates: [7, 6, 5, 4, 3, 2, 1], xStart: 76, xGap: 141 },
    { y: 574, count: 7, candidates: [14, 13, 12, 11, 10, 9, 8], xStart: 76, xGap: 141 },
    { y: 860, count: 7, candidates: [21, 20, 19, 18, 17, 16, 15], xStart: 76, xGap: 141 },
    { y: 1145, count: 5, candidates: [26, 25, 24, 23, 22], xStart: 217, xGap: 141 },
  ];

  for (const row of ffsRows) {
    for (let i = 0; i < row.count; i++) {
      const num = row.candidates[i];
      const left = Math.round(row.xStart + i * row.xGap);
      try {
        await sharp(ffsPoster)
          .extract({ left: Math.max(0, left), top: row.y, width: 128, height: 175 })
          .toFile(path.join(outDir, `ffs_${num}.jpg`));
      } catch (e) {
        console.error(`FFS ${num} error:`, e.message);
      }
    }
  }

  // 3. AMAYNUT (1414 x 2048)
  // Poster: public/assets/aistudio/55402744-3f24-4c68-a952-764a28eda9c5_9bb1fa40.jpg
  const amaynutPoster = 'public/assets/aistudio/55402744-3f24-4c68-a952-764a28eda9c5_9bb1fa40.jpg';
  // AMAYNUT Logo (top left circle badge)
  await sharp(amaynutPoster)
    .extract({ left: 30, top: 15, width: 220, height: 220 })
    .toFile(path.join(partyDir, 'amaynut.jpg'));

  // AMAYNUT Grid: 5 rows
  // Row 1: 01 to 06 (6 candidates)
  // Row 2: 07 to 12 (6 candidates)
  // Row 3: 13 to 18 (6 candidates)
  // Row 4: 19 to 24 (6 candidates)
  // Row 5: 25 to 26 (2 candidates)
  // Y starts around 360px
  const amaynutRows = [
    { y: 355, count: 6, startNum: 1, xStart: 60, xGap: 218 },
    { y: 645, count: 6, startNum: 7, xStart: 60, xGap: 218 },
    { y: 935, count: 6, startNum: 13, xStart: 60, xGap: 218 },
    { y: 1225, count: 6, startNum: 19, xStart: 60, xGap: 218 },
    { y: 1515, count: 2, startNum: 25, xStart: 496, xGap: 218 },
  ];

  for (const row of amaynutRows) {
    for (let i = 0; i < row.count; i++) {
      const num = row.startNum + i;
      const left = Math.round(row.xStart + i * row.xGap);
      try {
        await sharp(amaynutPoster)
          .extract({ left: Math.max(0, left), top: row.y, width: 185, height: 225 })
          .toFile(path.join(outDir, `amaynut_${num}.jpg`));
      } catch (e) {
        console.error(`AMAYNUT ${num} error:`, e.message);
      }
    }
  }

  // 4. RCD (1448 x 2048)
  // Poster: public/assets/aistudio/0c661a1c-81b9-44f3-bbe1-6b2ce6d60cb0_f4e52a08.jpg
  const rcdPoster = 'public/assets/aistudio/0c661a1c-81b9-44f3-bbe1-6b2ce6d60cb0_f4e52a08.jpg';
  // RCD Logo (top left blue/yellow RCD emblem)
  await sharp(rcdPoster)
    .extract({ left: 80, top: 30, width: 170, height: 210 })
    .toFile(path.join(partyDir, 'rcd.jpg'));

  // RCD Grid: 4 rows
  // Row 1: 01 to 06 (6 candidates)
  // Row 2: 07 to 13 (7 candidates)
  // Row 3: 14 to 20 (7 candidates)
  // Row 4: 21 to 26 (6 candidates)
  const rcdRows = [
    { y: 375, count: 6, startNum: 1, xStart: 140, xGap: 195, width: 175, height: 215 },
    { y: 680, count: 7, startNum: 7, xStart: 45, xGap: 194, width: 175, height: 215 },
    { y: 985, count: 7, startNum: 14, xStart: 45, xGap: 194, width: 175, height: 215 },
    { y: 1290, count: 6, startNum: 21, xStart: 140, xGap: 195, width: 175, height: 215 },
  ];

  for (const row of rcdRows) {
    for (let i = 0; i < row.count; i++) {
      const num = row.startNum + i;
      const left = Math.round(row.xStart + i * row.xGap);
      try {
        await sharp(rcdPoster)
          .extract({ left: Math.max(0, left), top: row.y, width: row.width, height: row.height })
          .toFile(path.join(outDir, `rcd_${num}.jpg`));
      } catch (e) {
        console.error(`RCD ${num} error:`, e.message);
      }
    }
  }

  console.log('Image extraction completed successfully!');
}

run();
