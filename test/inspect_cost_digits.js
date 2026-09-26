const fs = require('fs');

const bmp = fs.readFileSync('/tmp/sample1_test.bmp');
const W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22));
const rowSize = Math.floor((24 * W + 31) / 32) * 4;

// 12 badge centers from our detector:
const badgeCenters = [
    { cx: 45, cy: 49 },
    { cx: 206, cy: 49 },
    { cx: 367, cy: 49 },
    { cx: 530, cy: 50 },
    { cx: 692, cy: 51 },
    { cx: 853, cy: 50 },
    { cx: 45, cy: 278 },
    { cx: 207, cy: 279 },
    { cx: 369, cy: 279 },
    { cx: 530, cy: 279 },
    { cx: 692, cy: 279 },
    { cx: 852, cy: 278 }
];

const expectedDigits = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5];

badgeCenters.forEach((b, idx) => {
    // Crop 16x16 around center of badge
    console.log(`\n--- Badge ${idx+1} (Expected: ${expectedDigits[idx]}) at (${b.cx}, ${b.cy}) ---`);
    for (let dy = -7; dy <= 7; dy++) {
        let line = '';
        for (let dx = -7; dx <= 7; dx++) {
            const x = b.cx + dx, y = b.cy + dy;
            const i = 138 + y * rowSize + x * 3;
            const blue = bmp[i], green = bmp[i+1], red = bmp[i+2];
            // The digit is white (high R, high G, high B) or very bright
            const isWhiteDigit = (red > 180 && green > 180 && blue > 180);
            line += isWhiteDigit ? '#' : ' ';
        }
        console.log(line);
    }
});
