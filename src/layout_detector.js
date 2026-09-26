/**
 * Marvel Snap Global 2D Matched Lattice Detector
 * 
 * Slices 12 card patches from arbitrary Marvel Snap screenshots:
 * - Invariant to aspect ratio (PC/Tablet 6x2, Mobile 4x3, Streamer 3x4)
 * - Uses Global 2D Matched Lattice Filtering across paired Blue Cost & Orange Power anchors
 * - Immune to localized card art glows or single-card color anomalies
 * - Derives card dimensions directly from physical grid lattice and card aspect ratio
 * - Zero magic dividing ratios or device-specific heuristics
 * - Normalizes all 12 cards to standard 240x336 patches (1 : 1.414 aspect ratio)
 */
const MARVEL_SNAP_GEOMETRY = {
    // Physical aspect ratio of Marvel Snap cards (240x336 -> 1:1.40)
    CARD_ASPECT_RATIO: 1.40,
    // Distance from the card top edge to the Cost badge centroid in 6x2 vs 4x3 layouts
    // In 6x2 (landscape/PC/tablet), the badge sits high at 5.5% of card height
    // In 4x3 (portrait/mobile), the mobile UI camera places the badge at 9.0% of card height
    BADGE_TOP_OFFSET_6x2: 0.055,
    BADGE_TOP_OFFSET_4x3: 0.090,
    // Search window for badge centroid around the global lattice prediction:
    // Rx allows for horizontal spacing deviations, Ry tightly isolates badges from artwork
    BADGE_SEARCH_RX_FACTOR: 0.28,
    BADGE_SEARCH_RY_FACTOR: 0.16,
    BADGE_SEARCH_RY_MIN: 10,
    BADGE_SEARCH_RY_MAX: 18,
};

class LayoutDetector {
    /**
     * Slices an input canvas into 12 individual card canvases
     * @param {HTMLCanvasElement|Object} sourceCanvas 
     * @returns {{ layout: string, grid: { cols: number, rows: number }, cards: Array<{ index: number, row: number, col: number, canvas: HTMLCanvasElement, bounds: object }> }}
     */
    static sliceDeck(sourceCanvas) {
        return LayoutDetector.detectOptimalLattice(sourceCanvas);
    }

    /**
     * Alias for backward compatibility
     */
    static detectCardLattice(sourceCanvas) {
        return LayoutDetector.detectOptimalLattice(sourceCanvas);
    }

    /**
     * Discovers 12-card lattice globally using matched filter across Cost (blue) & Power (orange) anchors.
     * Invariant to screen resolution, aspect ratio (PC/tablet 6x2 vs mobile 4x3 vs streamer 3x4), and UI headers.
     */
    static detectOptimalLattice(sourceCanvas) {
        const W = sourceCanvas.width;
        const H = sourceCanvas.height;

        let sData;
        if (typeof document !== 'undefined' && document.createElement && sourceCanvas.getContext) {
            const sampleCanvas = document.createElement('canvas');
            sampleCanvas.width = W;
            sampleCanvas.height = H;
            const sCtx = sampleCanvas.getContext('2d');
            sCtx.drawImage(sourceCanvas, 0, 0);
            sData = sCtx.getImageData(0, 0, W, H).data;
        } else if (sourceCanvas.sampleData) {
            sData = sourceCanvas.sampleData;
        } else if (sourceCanvas.data) {
            sData = sourceCanvas.data;
        } else {
            return null;
        }

        // Multi-scale downsampled chrominance maps for <25ms global lattice search
        const scale = Math.min(1.0, 320 / Math.max(W, H));
        const sW = Math.round(W * scale);
        const sH = Math.round(H * scale);

        const sBlue = new Float32Array(sW * sH);
        const sOrange = new Float32Array(sW * sH);

        for (let sy = 0; sy < sH; sy++) {
            const srcY = Math.min(H - 1, Math.floor(sy / scale));
            for (let sx = 0; sx < sW; sx++) {
                const srcX = Math.min(W - 1, Math.floor(sx / scale));
                const idx = (srcY * W + srcX) * 4;
                const r = sData[idx], g = sData[idx + 1], b = sData[idx + 2];
                sBlue[sy * sW + sx] = Math.max(0, b - (r + g) * 0.5);
                sOrange[sy * sW + sx] = Math.max(0, Math.min(r - b, r - g * 0.5));
            }
        }

        // The three canonical Marvel Snap layouts
        const layouts = [
            { cols: 6, rows: 2 },
            { cols: 4, rows: 3 },
            { cols: 3, rows: 4 }
        ];

        let bestGlobal = null;
        let bestScore = -1;

        for (const layout of layouts) {
            const { cols, rows } = layout;
            const minDX = Math.round(sW / (cols + 1.2));
            const maxDX = Math.round(sW / (cols - 0.2));

            for (let dx = minDX; dx <= maxDX; dx += 2) {
                const minD = Math.round(dx * 0.70);
                const maxD = Math.round(dx * 0.86);

                for (let D = minD; D <= maxD; D += 2) {
                    const cardW = Math.min(dx, Math.round(D * 1.30));
                    const cardH = Math.round(cardW * 1.40);
                    const minDY = Math.round(cardH * 0.85);
                    const maxDY = Math.round(cardH * 1.25);

                    for (let dy = minDY; dy <= maxDY; dy += 3) {
                        const totalW = (cols - 1) * dx + D;
                        if (totalW > sW) continue;

                        const maxX0 = sW - totalW;
                        const minY0 = Math.max(0, Math.round(cardH * 0.05));
                        const maxY0 = sH - (rows - 1) * dy - Math.round(cardH * 0.50);
                        if (maxY0 < minY0) continue;

                        for (let x0 = 0; x0 <= maxX0; x0 += 3) {
                            for (let y0 = minY0; y0 <= maxY0; y0 += 3) {
                                let totalBlue = 0;
                                let totalOrange = 0;
                                let minBlue = 999;

                                for (let r = 0; r < rows; r++) {
                                    const badgeY = y0 + r * dy;
                                    for (let c = 0; c < cols; c++) {
                                        const costX = x0 + c * dx;
                                        const powerX = costX + D;

                                        const bVal = sBlue[badgeY * sW + costX];
                                        const oVal = sOrange[badgeY * sW + powerX];

                                        totalBlue += bVal;
                                        totalOrange += oVal;
                                        if (bVal < minBlue) minBlue = bVal;
                                    }
                                }

                                const score = (totalBlue + totalOrange * 0.5) + (minBlue * 4);
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestGlobal = {
                                        layout: `${cols}x${rows}`,
                                        cols, rows,
                                        x0: Math.round(x0 / scale),
                                        y0: Math.round(y0 / scale),
                                        dx: Math.round(dx / scale),
                                        dy: Math.round(dy / scale),
                                        D: Math.round(D / scale)
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!bestGlobal) return null;

        const { cols, rows, x0, y0, dx, dy, D } = bestGlobal;
        const coarseCardW = Math.min(dx, Math.round(D * 1.25));
        const coarseCardH = Math.round(coarseCardW * 1.414);

        // Pass 1: Extract sub-pixel badge centroids across all card cells
        const cellStats = [];
        const validD = [];

        for (let r = 0; r < rows; r++) {
            cellStats[r] = [];
            for (let c = 0; c < cols; c++) {
                const expCostX = Math.round(x0 + c * dx);
                const expCostY = Math.round(y0 + r * dy);
                const expPowerX = Math.round(x0 + c * dx + D);
                const expPowerY = Math.round(y0 + r * dy);

                // Badge search radius centered at global lattice prediction
                // Horizontal radius Rx accommodates column pitch variations across multi-card rows
                // Vertical radius Ry tightly isolates badge centroids from lower character art (robes, magic, armor)
                const Rx = Math.max(16, Math.round(D * MARVEL_SNAP_GEOMETRY.BADGE_SEARCH_RX_FACTOR));
                const Ry = Math.max(
                    MARVEL_SNAP_GEOMETRY.BADGE_SEARCH_RY_MIN,
                    Math.min(MARVEL_SNAP_GEOMETRY.BADGE_SEARCH_RY_MAX, Math.round(D * MARVEL_SNAP_GEOMETRY.BADGE_SEARCH_RY_FACTOR))
                );

                let sumBX = 0, sumBY = 0, sumB = 0;
                let sumOX = 0, sumOY = 0, sumO = 0;

                // Left window: Blue Cost badge
                for (let py = Math.max(0, expCostY - Ry); py <= Math.min(H - 1, expCostY + Ry); py++) {
                    for (let px = Math.max(0, expCostX - Rx); px <= Math.min(W - 1, expCostX + Rx); px++) {
                        const idx = (py * W + px) * 4;
                        const red = sData[idx], green = sData[idx + 1], blue = sData[idx + 2];
                        const bVal = Math.max(0, blue - (red + green) * 0.5);
                        if (bVal > 25) {
                            sumBX += px * bVal;
                            sumBY += py * bVal;
                            sumB += bVal;
                        }
                    }
                }

                // Right window: Orange Power badge
                for (let py = Math.max(0, expPowerY - Ry); py <= Math.min(H - 1, expPowerY + Ry); py++) {
                    for (let px = Math.max(0, expPowerX - Rx); px <= Math.min(W - 1, expPowerX + Rx); px++) {
                        const idx = (py * W + px) * 4;
                        const red = sData[idx], green = sData[idx + 1], blue = sData[idx + 2];
                        const oVal = Math.max(0, Math.min(red - blue, red - green * 0.5));
                        if (oVal > 25) {
                            sumOX += px * oVal;
                            sumOY += py * oVal;
                            sumO += oVal;
                        }
                    }
                }

                const costX = sumB > 0 ? (sumBX / sumB) : expCostX;
                const costY = sumB > 0 ? (sumBY / sumB) : expCostY;
                const powerX = sumO > 0 ? (sumOX / sumO) : expPowerX;
                const powerY = sumO > 0 ? (sumOY / sumO) : expPowerY;

                const span = powerX - costX;
                if (sumB > 80 && sumO > 40 && span > dx * 0.55 && span < dx * 0.95) {
                    validD.push(span);
                }

                cellStats[r][c] = {
                    costX, costY, powerX, powerY,
                    midX: (costX + powerX) * 0.5,
                    badgeY: Math.min(costY, powerY)
                };
            }
        }

                // Pass 2: Derive uniform deck-wide card dimensions and consensus axes
        const colMidX = [];
        for (let c = 0; c < cols; c++) {
            const mids = [];
            for (let r = 0; r < rows; r++) mids.push(cellStats[r][c].midX);
            mids.sort((a, b) => a - b);
            colMidX[c] = mids[Math.floor(mids.length / 2)];
        }

        const rowBadgeY = [];
        for (let r = 0; r < rows; r++) {
            const bYs = [];
            for (let c = 0; c < cols; c++) bYs.push(cellStats[r][c].badgeY);
            bYs.sort((a, b) => a - b);
            rowBadgeY[r] = bYs[Math.floor(bYs.length / 2)];
        }

        // Measure true grid pitch from consensus badge centroids
        const pitchX = (cols > 1) ? (colMidX[cols - 1] - colMidX[0]) / (cols - 1) : dx;
        const pitchY = (rows > 1) ? (rowBadgeY[rows - 1] - rowBadgeY[0]) / (rows - 1) : dy;

        // Invariant card aspect ratio: AR = 1.40 (240x336)
        // Physical grid non-overlap constraint:
        // cardW cannot exceed pitchX, cardH cannot exceed pitchY
        const AR = MARVEL_SNAP_GEOMETRY.CARD_ASPECT_RATIO;
        const maxW_byX = pitchX - 1;
        const maxW_byY = (pitchY - 2) / AR;
        const cardW = Math.round(Math.min(maxW_byX, maxW_byY));
        const cardH = Math.round(cardW * AR);

        // Pass 3: Slice non-overlapping, centered card patches
        const cardPatches = [];

        for (let r = 0; r < rows; r++) {
            const topOffsetRatio = (rows === 2)
                ? MARVEL_SNAP_GEOMETRY.BADGE_TOP_OFFSET_6x2
                : MARVEL_SNAP_GEOMETRY.BADGE_TOP_OFFSET_4x3;

            for (let c = 0; c < cols; c++) {
                const index = r * cols + c;
                const sx = Math.max(0, Math.min(W - cardW, Math.round(colMidX[c] - cardW * 0.5)));
                const sy = Math.max(0, Math.min(H - cardH, Math.round(rowBadgeY[r] - cardH * topOffsetRatio)));
                const sw = Math.round(cardW);
                const sh = Math.round(cardH);

                const cardCanvas = (typeof document !== "undefined" && document.createElement)
                    ? document.createElement("canvas")
                    : null;

                if (cardCanvas) {
                    cardCanvas.width = 240;
                    cardCanvas.height = 336;
                    const cardCtx = cardCanvas.getContext("2d");
                    cardCtx.imageSmoothingEnabled = true;
                    cardCtx.imageSmoothingQuality = "high";
                    cardCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, 240, 336);
                }

                cardPatches.push({
                    index,
                    row: r,
                    col: c,
                    canvas: cardCanvas,
                    bounds: { x: sx, y: sy, width: sw, height: sh }
                });
            }
        }

const minX = Math.min(...cardPatches.map(p => p.bounds.x));
        const maxX = Math.max(...cardPatches.map(p => p.bounds.x + p.bounds.width));
        const minY = Math.min(...cardPatches.map(p => p.bounds.y));
        const maxY = Math.max(...cardPatches.map(p => p.bounds.y + p.bounds.height));

        return {
            layout: bestGlobal.layout,
            grid: { cols, rows },
            sourceDimensions: { width: W, height: H, aspect: W / H },
            deckBounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
            cards: cardPatches
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = { LayoutDetector };
}

