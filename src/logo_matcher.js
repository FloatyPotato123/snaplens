/**
 * Marvel Snap Fast Native Logo Matcher (ZNCC Engine)
 * 
 * Matches sliced card canvases against native reference logo templates
 * using Masked Zero-mean Normalized Cross-Correlation (ZNCC).
 * 
 * Invariance Properties:
 * - Linear brightness and contrast invariant: (I - I_mean) / sigma_I
 * - Invariant to card variants: Inked (B&W), Gold monochrome, Rainbow Foil, and 3D glares
 * - Robust to stylized comic typography that defeats traditional OCR
 * 
 * Architecture:
 * - Centered Horizontal Prior: anchors search around card center (+-12px), cutting permutations by 20x
 * - Coarse-to-Fine Search: 2x downscaled screen across 700+ candidates followed by sub-pixel fine refinement
/**
 * Marvel Snap Card Visual Specifications & Template Matcher Constants
 * 
 * Physical Layout of a standard 240x336 Marvel Snap card:
 * - y: 0 to 60 (top 18%): Card top frame, Cost (left) and Power (right) badges
 * - y: 60 to 220 (middle 48%): Character artwork, 3D breaks, framebreak effects
 * - y: 200 to 318 (lower 30%): Card Logo / Name banner
 * - y: 318 to 336 (bottom 5%): Ability text description panel / rarity trim
 * 
 * In Marvel Snap client renders:
 * 1. The bottom of the title logo NEVER crosses into the ability description panel
 *    (yBottom <= 318 on 336h canvas).
 * 2. Multi-scale search is anchored at 1.00x because all cards are rendered at identical
 *    mesh scale in the deck view. Any deviations (e.g. 0.96x or 1.04x) must prove a statistically
 *    significant correlation gain (minDelta) over the natural 1.00x baseline to prevent
 *    overfitting to high-frequency image noise.
 */
const MARVEL_SNAP_LOGO_SPEC = {
    // Canvas dimensions normalized by LayoutDetector
    CANVAS_WIDTH: 240,
    CANVAS_HEIGHT: 336,

    // Vertical boundary: card logo baseline limit (accommodates tall multi-line and standard logos)
    LOGO_BASELINE_MAX_Y: 350,

    // Scale search hypothesis testing:
    // Scale 1.0 is the physical rendering scale in the Marvel Snap deck view.
    // Scales deviating by >= 4% (s <= 0.96 or s >= 1.04) must exceed scale 1.0 correlation
    // by at least MIN_SCALE_IMPROVEMENT_DELTA (0.060), and minor deviations by MIN_SCALE_IMPROVEMENT_MINOR (0.035).
    SCALE_DEVIATION_THRESHOLD: 0.04,
    MIN_SCALE_IMPROVEMENT_DELTA: 0.060,
    MIN_SCALE_IMPROVEMENT_MINOR: 0.035,

    // Multi-scale refinement candidates within delta of leader:
    MULTI_SCALE_TRIGGER_ZNCC: 0.15,
    MULTI_SCALE_MAX_DELTA_FROM_LEADER: 0.25,

    // Universal scale exploration bracket
    SCALES: [0.92, 0.95, 0.98, 1.02, 1.05],

    // Maximum expected horizontal slice jitter (8px deadband)
    CENTERING_DEADBAND_PX: 8,
    CENTERING_PENALTY_RATE: 0.010,

    // Physical baseline geometry:
    // Standard cards rest on shelf at baseline ~ 302..320 depending on logo height (sh).
    // Baselines outside [MIN_BASELINE_PX, MAX_BASELINE_BASE_PX + excess] are penalized.
    BASELINE_MIN_PX: 294,
    BASELINE_MAX_BASE_PX: 308,
    BASELINE_HEIGHT_SLOPE: 0.25,
    BASELINE_PENALTY_RATE: 0.010,
};

class LogoMatcher {
    constructor(templatesData = null, wasmBinary = null) {
        this.isReady = false;
        this.templates = [];
        this.wasm = null;

        if (templatesData) {
            this.initDatabase(templatesData, wasmBinary);
        }
    }

    /**
     * Initializes templates database from JSON data (cards_templates.json)
     * @param {Object} templatesData - Dictionary of cardDefId -> template object
     */
    initDatabase(templatesData, wasmBinary = null) {
        const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.templates = [];

        for (const [defId, entry] of Object.entries(templatesData)) {
            const sw = entry.sw;
            const sh = entry.sh;
            if (!sw || !sh || !entry.mask || !entry.gray) continue;

            // Decode base64 mask and gray arrays
            let maskBuf, grayBuf;
            if (typeof Buffer !== 'undefined') {
                maskBuf = Buffer.from(entry.mask, 'base64');
                grayBuf = Buffer.from(entry.gray, 'base64');
            } else if (typeof atob === 'function') {
                const binMask = atob(entry.mask);
                maskBuf = new Uint8Array(binMask.length);
                for (let i = 0; i < binMask.length; i++) maskBuf[i] = binMask.charCodeAt(i);

                const binGray = atob(entry.gray);
                grayBuf = new Uint8Array(binGray.length);
                for (let i = 0; i < binGray.length; i++) grayBuf[i] = binGray.charCodeAt(i);
            }

            const sGray = new Int8Array(grayBuf.buffer, grayBuf.byteOffset, grayBuf.length);

            // Precompute fine active points
            const sPointsX = new Int16Array(entry.sCount);
            const sPointsY = new Int16Array(entry.sCount);
            const sPointsVal = new Float32Array(entry.sCount);
            let sIdx = 0;
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    const idx = y * sw + x;
                    if ((maskBuf[idx >> 3] >> (idx & 7)) & 1) {
                        sPointsX[sIdx] = x;
                        sPointsY[sIdx] = y;
                        sPointsVal[sIdx] = sGray[idx];
                        sIdx++;
                    }
                }
            }

            // Precompute 2x downscaled coarse template using 2x2 box filter (preserves thin strokes)
            const cw = Math.round(sw / 2);
            const ch = Math.round(sh / 2);
            const cMask = new Uint8Array(cw * ch);
            const cGray = new Float32Array(cw * ch);
            let cCount = 0;
            let cSum = 0;

            for (let cy = 0; cy < ch; cy++) {
                const sy0 = cy * 2;
                const sy1 = Math.min(sh - 1, sy0 + 1);
                const cRow = cy * cw;
                for (let cx = 0; cx < cw; cx++) {
                    const sx0 = cx * 2;
                    const sx1 = Math.min(sw - 1, sx0 + 1);

                    let boxSum = 0;
                    let boxCount = 0;

                    for (let sy = sy0; sy <= sy1; sy++) {
                        const sRow = sy * sw;
                        for (let sx = sx0; sx <= sx1; sx++) {
                            const pIdx = sRow + sx;
                            if ((maskBuf[pIdx >> 3] >> (pIdx & 7)) & 1) {
                                boxSum += sGray[pIdx];
                                boxCount++;
                            }
                        }
                    }

                    if (boxCount > 0) {
                        const val = boxSum / boxCount;
                        cGray[cRow + cx] = val;
                        cMask[cRow + cx] = 1;
                        cSum += val;
                        cCount++;
                    }
                }
            }

            if (cCount < 10) continue;

            const cMean = cSum / cCount;
            let cStd = 0;
            const cPointsX = new Int16Array(cCount);
            const cPointsY = new Int16Array(cCount);
            const cPointsVal = new Float32Array(cCount);
            let ptIdx = 0;

            for (let cy = 0; cy < ch; cy++) {
                const cRow = cy * cw;
                for (let cx = 0; cx < cw; cx++) {
                    const idx = cRow + cx;
                    if (cMask[idx]) {
                        const val = cGray[idx] - cMean;
                        cGray[idx] = val;
                        cStd += val * val;
                        cPointsX[ptIdx] = cx;
                        cPointsY[ptIdx] = cy;
                        cPointsVal[ptIdx] = val;
                        ptIdx++;
                    }
                }
            }

            // Stride 3 subsampling for coarse search with exact zero-mean centering
            const stride = 3;
            const subCount = Math.floor(ptIdx / stride);
            const subPointsX = new Int16Array(subCount);
            const subPointsY = new Int16Array(subCount);
            const subPointsVal = new Float32Array(subCount);
            const sc090PointsX = new Int16Array(subCount);
            const sc090PointsY = new Int16Array(subCount);
            let subSum = 0;
            for (let i = 0; i < subCount; i++) {
                const src = i * stride;
                subPointsX[i] = cPointsX[src];
                subPointsY[i] = cPointsY[src];
                subPointsVal[i] = cPointsVal[src];
                subSum += subPointsVal[i];
                sc090PointsX[i] = Math.round(cPointsX[src] * 0.90);
                sc090PointsY[i] = Math.round(cPointsY[src] * 0.90);
            }
            const subMean = subSum / subCount;
            let subStd = 0;
            for (let i = 0; i < subCount; i++) {
                subPointsVal[i] -= subMean;
                subStd += subPointsVal[i] * subPointsVal[i];
            }

            const cOffsets = new Int32Array(subCount);
            for (let i = 0; i < subCount; i++) {
                cOffsets[i] = subPointsY[i] * 120 + subPointsX[i];
            }

            // Precompute fine 1D offsets and template sum for fast contained-rectangle inner loop
            const sOffsets = new Int32Array(entry.sCount);
            let sSumTpl = 0;
            for (let i = 0; i < entry.sCount; i++) {
                sOffsets[i] = sPointsY[i] * 240 + sPointsX[i];
                sSumTpl += sPointsVal[i];
            }

            // Stride 2 subsampling for fine search: 2x faster, identical statistical correlation
            const subFineCount = Math.floor(entry.sCount / 2);
            const subFinePointsX = new Int16Array(subFineCount);
            const subFinePointsY = new Int16Array(subFineCount);
            const subFinePointsVal = new Float32Array(subFineCount);
            let subFineStd = 0, subFineSum = 0;
            for (let i = 0; i < subFineCount; i++) {
                const src = i * 2;
                subFinePointsX[i] = sPointsX[src];
                subFinePointsY[i] = sPointsY[src];
                subFinePointsVal[i] = sPointsVal[src];
                subFineStd += subFinePointsVal[i] * subFinePointsVal[i];
                subFineSum += subFinePointsVal[i];
            }

            this.templates.push({
                defId,
                name: entry.name || defId,
                cost: entry.cost !== undefined ? entry.cost : 0,
                power: entry.power !== undefined ? entry.power : 0,
                sw, sh,
                sCount: entry.sCount,
                sStd: entry.sStd,
                sInvStd: 1.0 / entry.sStd,
                mask: maskBuf,
                gray: sGray,
                sPointsX,
                sPointsY,
                sPointsVal,
                sOffsets,
                sSumTpl,
                subFinePointsX,
                subFinePointsY,
                subFinePointsVal,
                subFineCount,
                subFineStd: Math.sqrt(subFineStd),
                subFineSum,
                cw, ch,
                cw090: Math.round(cw * 0.90),
                ch090: Math.round(ch * 0.90),
                cMask,
                cGray,
                cCount: subCount,
                cStd: Math.sqrt(subStd),
                cPointsX: subPointsX,
                cPointsY: subPointsY,
                cPointsVal: subPointsVal,
                cOffsets,
                cSumTpl: 0,
                sc090PointsX,
                sc090PointsY
            });
        }

        // Scratch buffers for multi-scale point coordinates (avoids millions of inner-loop allocations)
        this.scaledPointsX = new Int16Array(25000);
        this.scaledPointsY = new Int16Array(25000);

        this.isReady = true;
        const elapsed = (typeof performance !== 'undefined') ? (performance.now() - t0).toFixed(1) : (Date.now() - t0);
        console.log(`[LogoMatcher] Initialized ${this.templates.length} card logo templates in ${elapsed}ms`);

        if (wasmBinary || (typeof process !== 'undefined' && process.versions && process.versions.node)) {
            this.initWasm(wasmBinary);
        }
    }

    /**
     * Initializes the AssemblyScript WebAssembly + SIMD matching engine
     * @param {ArrayBuffer|Buffer|null} wasmBinary - WASM binary buffer
     * @returns {boolean} Whether WASM initialization succeeded
     */
    initWasm(wasmBinary = null) {
        if (!wasmBinary) {
            if (typeof require !== 'undefined' && typeof process !== 'undefined' && process.versions && process.versions.node) {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const p = path.join(__dirname, 'wasm/matcher.wasm');
                    if (fs.existsSync(p)) wasmBinary = fs.readFileSync(p);
                } catch (_) {}
            }
        }
        if (!wasmBinary) return false;

        try {
            const module = new WebAssembly.Module(wasmBinary);
            const instance = new WebAssembly.Instance(module, { env: { abort: () => {} } });
            this.wasm = instance.exports;
            this.wasm.memory.grow(200);

            let ptr = this.wasm.getDynamicHeapPtr();
            for (const tpl of this.templates) {
                ptr = (ptr + 3) & ~3;
                tpl.cOffsetsPtr = ptr;
                new Int32Array(this.wasm.memory.buffer, ptr, tpl.cCount).set(tpl.cOffsets);
                ptr += tpl.cCount * 4;

                ptr = (ptr + 3) & ~3;
                tpl.cPointsXPtr = ptr;
                new Int16Array(this.wasm.memory.buffer, ptr, tpl.cCount).set(tpl.cPointsX);
                ptr += tpl.cCount * 2;

                ptr = (ptr + 3) & ~3;
                tpl.cPointsYPtr = ptr;
                new Int16Array(this.wasm.memory.buffer, ptr, tpl.cCount).set(tpl.cPointsY);
                ptr += tpl.cCount * 2;

                ptr = (ptr + 3) & ~3;
                tpl.cPointsValPtr = ptr;
                new Float32Array(this.wasm.memory.buffer, ptr, tpl.cCount).set(tpl.cPointsVal);
                ptr += tpl.cCount * 4;
            }

            const MAX_FINE_POINTS = 32768;
            ptr = (ptr + 15) & ~15;
            this.FINE_OFF_PTR = ptr; ptr += MAX_FINE_POINTS * 4;
            this.FINE_X_PTR = ptr; ptr += MAX_FINE_POINTS * 2;
            this.FINE_Y_PTR = ptr; ptr += MAX_FINE_POINTS * 2;
            ptr = (ptr + 3) & ~3;
            this.FINE_VAL_PTR = ptr; ptr += MAX_FINE_POINTS * 4;
            this.SCALED_X_PTR = ptr; ptr += MAX_FINE_POINTS * 2;
            this.SCALED_Y_PTR = ptr; ptr += MAX_FINE_POINTS * 2;

            this.scratchOffsets = new Int32Array(this.wasm.memory.buffer, this.FINE_OFF_PTR, MAX_FINE_POINTS);
            this.scratchX = new Int16Array(this.wasm.memory.buffer, this.FINE_X_PTR, MAX_FINE_POINTS);
            this.scratchY = new Int16Array(this.wasm.memory.buffer, this.FINE_Y_PTR, MAX_FINE_POINTS);
            this.scratchVal = new Float32Array(this.wasm.memory.buffer, this.FINE_VAL_PTR, MAX_FINE_POINTS);
            this.scaledX = new Int16Array(this.wasm.memory.buffer, this.SCALED_X_PTR, MAX_FINE_POINTS);
            this.scaledY = new Int16Array(this.wasm.memory.buffer, this.SCALED_Y_PTR, MAX_FINE_POINTS);

            this.wasmCardGray = new Float32Array(this.wasm.memory.buffer, this.wasm.getCardGrayPtr(), 240 * 336);
            this.wasmDownGray = new Float32Array(this.wasm.memory.buffer, this.wasm.getDownGrayPtr(), 120 * 168);
            console.log(`[LogoMatcher] WebAssembly SIMD Acceleration Enabled! Coarse templates heap: ${(ptr / 1024).toFixed(0)} KB`);
            return true;
        } catch (e) {
            console.warn('[LogoMatcher] Failed to initialize WASM engine:', e);
            this.wasm = null;
            return false;
        }
    }

    /**
     * Matches a normalized 240x336 card canvas against reference logo templates
     * 
     * @param {HTMLCanvasElement|Object} cardCanvas - 240x336 card canvas
     * @param {number|null} targetCost - Estimated cost if known, or null
     * @param {number|null} targetPower - Estimated power if known, or null
     * @returns {Array<{ card: Object, score: number, coarseScore: number, x: number, y: number }>}
     */
    matchCard(cardCanvas, targetCost = null, targetPower = null) {
        if (!this.isReady || this.templates.length === 0) return [];
        if (this.wasm) {
            return this.matchCardWasm(cardCanvas, targetCost, targetPower);
        }

        const cCtx = cardCanvas.getContext('2d');
        const cImg = cCtx.getImageData(0, 0, cardCanvas.width, cardCanvas.height).data;
        const cW = cardCanvas.width;
        const cH = cardCanvas.height;

        // 1. Extract zero-mean luminance for card
        const cardGray = new Float32Array(cW * cH);
        for (let i = 0; i < cW * cH; i++) {
            const idx = i << 2;
            cardGray[i] = 0.299 * cImg[idx] + 0.587 * cImg[idx + 1] + 0.114 * cImg[idx + 2];
        }

        // 2. Downscale card 2x to coarse space (120x168) using 2x2 box filter
        const dW = Math.round(cW / 2);
        const dH = Math.round(cH / 2);
        const downGray = new Float32Array(dW * dH);
        for (let y = 0; y < dH; y++) {
            const y0 = y * 2;
            const y1 = Math.min(cH - 1, y0 + 1);
            const dstRow = y * dW;
            for (let x = 0; x < dW; x++) {
                const x0 = x * 2;
                const x1 = Math.min(cW - 1, x0 + 1);
                downGray[dstRow + x] = (
                    cardGray[y0 * cW + x0] +
                    cardGray[y0 * cW + x1] +
                    cardGray[y1 * cW + x0] +
                    cardGray[y1 * cW + x1]
                ) * 0.25;
            }
        }

        // 3. Stage 1: Fast Coarse Screening across all 650+ templates anchored at physical baseline
        const coarseScores = [];
        const numTemplates = this.templates.length;

        for (let t = 0; t < numTemplates; t++) {
            const tpl = this.templates[t];
            const cw = tpl.cw;
            const ch = tpl.ch;
            const baseX1 = Math.round((dW - cw) / 2);
            const cPointsX = tpl.cPointsX;
            const cPointsY = tpl.cPointsY;
            const cPointsVal = tpl.cPointsVal;
            const cCount = tpl.cCount;
            const minOverlap = cCount * 0.50;
            const cStd = tpl.cStd;

            // Physical baseline anchoring: Card frame baseline is at yBottom ~ 156 in coarse space (312 in fine)
            const expCY = Math.round(156 - ch);
            const minCY = Math.max(65, expCY - 18);
            const maxCY = Math.min(dH - Math.round(ch * 0.70), expCY + 18);
            const tplSum = tpl.cSumTpl;

            let bestZNCC = -1;
            let bestCX = baseX1;
            let bestCY = expCY;

            const cOffsets = tpl.cOffsets;

            const cRem = cCount & 3;
            const cCount4 = cCount - cRem;

            // Stride-2 coarse search across baseline window
            for (let cy = minCY; cy <= maxCY; cy += 2) {
                const cyInside = (cy >= 0 && cy + ch < dH);
                const rowOffset = cy * dW;
                for (let cx = baseX1 - 8; cx <= baseX1 + 8; cx += 2) {
                    const baseIdx = rowOffset + cx;
                    let sum = 0, sumSq = 0, dotRaw = 0, sumTpl = 0, overlap = 0;

                    if (cyInside && cx >= 0 && cx + cw < dW) {
                        for (let p = 0; p < cCount4; p += 4) {
                            const v0 = downGray[baseIdx + cOffsets[p]];
                            const v1 = downGray[baseIdx + cOffsets[p + 1]];
                            const v2 = downGray[baseIdx + cOffsets[p + 2]];
                            const v3 = downGray[baseIdx + cOffsets[p + 3]];
                            sum += v0 + v1 + v2 + v3;
                            sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
                            dotRaw += cPointsVal[p] * v0 + cPointsVal[p + 1] * v1 + cPointsVal[p + 2] * v2 + cPointsVal[p + 3] * v3;
                        }
                        for (let p = cCount4; p < cCount; p++) {
                            const val = downGray[baseIdx + cOffsets[p]];
                            sum += val; sumSq += val * val; dotRaw += cPointsVal[p] * val;
                        }
                        sumTpl = tplSum; overlap = cCount;
                    } else {
                        for (let p = 0; p < cCount; p++) {
                            const px = cx + cPointsX[p];
                            const py = cy + cPointsY[p];
                            if (px >= 0 && px < dW && py >= 0 && py < dH) {
                                const val = downGray[baseIdx + cOffsets[p]];
                                const tVal = cPointsVal[p];
                                sum += val; sumSq += val * val; dotRaw += tVal * val;
                                sumTpl += tVal; overlap++;
                            }
                        }
                        if (overlap < minOverlap) continue;
                    }
                    const dot = dotRaw - (sum / overlap) * sumTpl;
                    if (dot <= 0) continue;
                    const iStd = sumSq - (sum * sum) / overlap;
                    if (iStd < 25) continue;
                    const zncc = dot / (cStd * Math.sqrt(iStd));
                    if (zncc > bestZNCC) { bestZNCC = zncc; bestCX = cx; bestCY = cy; }
                }
            }

            // Local 1px peak refinement around best coarse anchor
            if (bestZNCC > 0.10) {
                const anchorCX = bestCX, anchorCY = bestCY;
                for (let dcy = -1; dcy <= 1; dcy++) {
                    const cy = anchorCY + dcy;
                    if (cy < minCY || cy > maxCY) continue;
                    const cyInside = (cy >= 0 && cy + ch < dH);
                    const rowOffset = cy * dW;
                    for (let dcx = -1; dcx <= 1; dcx++) {
                        if (dcx === 0 && dcy === 0) continue;
                        const cx = anchorCX + dcx;
                        if (cx < baseX1 - 8 || cx > baseX1 + 8) continue;
                        const baseIdx = rowOffset + cx;
                        let sum = 0, sumSq = 0, dotRaw = 0, sumTpl = 0, overlap = 0;
                        if (cyInside && cx >= 0 && cx + cw < dW) {
                            for (let p = 0; p < cCount4; p += 4) {
                                const v0 = downGray[baseIdx + cOffsets[p]];
                                const v1 = downGray[baseIdx + cOffsets[p + 1]];
                                const v2 = downGray[baseIdx + cOffsets[p + 2]];
                                const v3 = downGray[baseIdx + cOffsets[p + 3]];
                                sum += v0 + v1 + v2 + v3;
                                sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
                                dotRaw += cPointsVal[p] * v0 + cPointsVal[p + 1] * v1 + cPointsVal[p + 2] * v2 + cPointsVal[p + 3] * v3;
                            }
                            for (let p = cCount4; p < cCount; p++) {
                                const val = downGray[baseIdx + cOffsets[p]];
                                sum += val; sumSq += val * val; dotRaw += cPointsVal[p] * val;
                            }
                            sumTpl = tplSum; overlap = cCount;
                        } else {
                            for (let p = 0; p < cCount; p++) {
                                const px = cx + cPointsX[p];
                                const py = cy + cPointsY[p];
                                if (px >= 0 && px < dW && py >= 0 && py < dH) {
                                    const val = downGray[baseIdx + cOffsets[p]];
                                    const tVal = cPointsVal[p];
                                    sum += val; sumSq += val * val; dotRaw += tVal * val;
                                    sumTpl += tVal; overlap++;
                                }
                            }
                            if (overlap < minOverlap) continue;
                        }
                        const dot = dotRaw - (sum / overlap) * sumTpl;
                        if (dot <= 0) continue;
                        const iStd = sumSq - (sum * sum) / overlap;
                        if (iStd < 25) continue;
                        const zncc = dot / (cStd * Math.sqrt(iStd));
                        if (zncc > bestZNCC) { bestZNCC = zncc; bestCX = cx; bestCY = cy; }
                    }
                }
            }

            coarseScores.push({ tpl, coarseZNCC: bestZNCC, bestCX, bestCY, bestScale: 1.0 });
        }

        coarseScores.sort((a, b) => b.coarseZNCC - a.coarseZNCC);
        // Retain top 300 candidates for full-resolution fine refinement
        const topCandidates = coarseScores.slice(0, 300);

        // 4. Stage 2: Full-Resolution Fine Refinement at Scale 1.0
        const intermediate = [];
        let maxObservedScore = 0;
        const maxBaselineY = MARVEL_SNAP_LOGO_SPEC.LOGO_BASELINE_MAX_Y;

        for (let i = 0; i < topCandidates.length; i++) {
            const item = topCandidates[i];
            const tpl = item.tpl;
            const fineBaseX = item.bestCX * 2;
            const fineBaseY = item.bestCY * 2;
            const sPointsX = tpl.sPointsX;
            const sPointsY = tpl.sPointsY;
            const sPointsVal = tpl.sPointsVal;
            const sCount = tpl.sCount;
            const minFineOverlap = sCount * 0.65;
            const sStd = tpl.sStd;

            let bestFineZNCC = -1;
            let bestFineX = fineBaseX;
            let bestFineY = fineBaseY;

            // Search +/- 3px window around coarse anchor at scale 1.0
            const sOffsets = tpl.sOffsets;
            const sRem = sCount & 3;
            const sCount4 = sCount - sRem;
            const sInvStd = tpl.sInvStd;
            const sSumTpl = tpl.sSumTpl;

            for (let cy = fineBaseY - 3; cy <= fineBaseY + 3; cy += 1) {
                if (cy + Math.round(tpl.sh * 1.0) > maxBaselineY) continue;
                const cyInside = (cy >= 0 && cy + tpl.sh < cH);
                const rowOffset = cy * cW;
                for (let cx = fineBaseX - 3; cx <= fineBaseX + 3; cx += 1) {
                    let sum = 0, sumSq = 0, dotRaw = 0, sumTpl = 0, overlap = 0;

                    if (cyInside && cx >= 0 && cx + tpl.sw < cW) {
                        const baseIdx = rowOffset + cx;
                        for (let p = 0; p < sCount4; p += 4) {
                            const v0 = cardGray[baseIdx + sOffsets[p]];
                            const v1 = cardGray[baseIdx + sOffsets[p + 1]];
                            const v2 = cardGray[baseIdx + sOffsets[p + 2]];
                            const v3 = cardGray[baseIdx + sOffsets[p + 3]];

                            sum += v0 + v1 + v2 + v3;
                            sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
                            dotRaw += sPointsVal[p] * v0 + sPointsVal[p + 1] * v1 + sPointsVal[p + 2] * v2 + sPointsVal[p + 3] * v3;
                        }
                        for (let p = sCount4; p < sCount; p++) {
                            const val = cardGray[baseIdx + sOffsets[p]];
                            sum += val;
                            sumSq += val * val;
                            dotRaw += sPointsVal[p] * val;
                        }
                        sumTpl = sSumTpl;
                        overlap = sCount;
                    } else {
                        for (let p = 0; p < sCount; p++) {
                            const px = cx + sPointsX[p];
                            const py = cy + sPointsY[p];
                            if (px >= 0 && px < cW && py >= 0 && py < cH) {
                                const val = cardGray[py * cW + px];
                                const tVal = sPointsVal[p];
                                sum += val;
                                sumSq += val * val;
                                dotRaw += tVal * val;
                                sumTpl += tVal;
                                overlap++;
                            }
                        }
                        if (overlap < minFineOverlap) continue;
                    }

                    const dot = dotRaw - (sum / overlap) * sumTpl;
                    if (dot <= 0) continue;

                    const iStd = sumSq - (sum * sum) / overlap;
                    if (iStd < 50) continue;

                    const zncc = (dot * sInvStd) / Math.sqrt(iStd);
                    if (isFinite(zncc) && zncc > bestFineZNCC) {
                        bestFineZNCC = zncc;
                        bestFineX = cx;
                        bestFineY = cy;
                    }
                }
            }

            if (bestFineZNCC > maxObservedScore) maxObservedScore = bestFineZNCC;
            intermediate.push({
                tpl,
                item,
                bestFineZNCC,
                bestFineX,
                bestFineY,
                scale1ZNCC: bestFineZNCC,
                bestScale: 1.0
            });
        }

        // Pass 2: Universal multi-scale refinement for candidates near leader
        const minTrigger = Math.max(
            MARVEL_SNAP_LOGO_SPEC.MULTI_SCALE_TRIGGER_ZNCC,
            maxObservedScore - MARVEL_SNAP_LOGO_SPEC.MULTI_SCALE_MAX_DELTA_FROM_LEADER
        );

        const fineResults = [];
        const scaledPointsX = this.scaledPointsX;
        const scaledPointsY = this.scaledPointsY;

        for (let i = 0; i < intermediate.length; i++) {
            const cand = intermediate[i];
            const tpl = cand.tpl;
            let bestFineZNCC = cand.bestFineZNCC;
            let bestFineX = cand.bestFineX;
            let bestFineY = cand.bestFineY;
            let bestScale = cand.bestScale;
            const scale1ZNCC = cand.scale1ZNCC;

            if (bestFineZNCC >= minTrigger) {
                const sPointsX = tpl.sPointsX;
                const sPointsY = tpl.sPointsY;
                const sPointsVal = tpl.sPointsVal;
                const sCount = tpl.sCount;
                const minFineOverlap = sCount * 0.65;
                const sStd = tpl.sStd;

                for (const s of MARVEL_SNAP_LOGO_SPEC.SCALES) {
                    const scaledH = Math.round(tpl.sh * s);
                    if (bestFineY - 3 + scaledH > maxBaselineY) continue;

                    for (let p = 0; p < sCount; p++) {
                        scaledPointsX[p] = Math.round(sPointsX[p] * s);
                        scaledPointsY[p] = Math.round(sPointsY[p] * s);
                    }

                    for (let cy = bestFineY - 3; cy <= bestFineY + 3; cy += 1) {
                        if (cy + scaledH > maxBaselineY) continue;
                        for (let cx = bestFineX - 4; cx <= bestFineX + 4; cx += 1) {
                            let sum = 0, sumSq = 0, dotRaw = 0, sumTpl = 0, overlap = 0;
                            for (let p = 0; p < sCount; p++) {
                                const px = cx + scaledPointsX[p];
                                const py = cy + scaledPointsY[p];
                                if (px >= 0 && px < cW && py >= 0 && py < cH) {
                                    const val = cardGray[py * cW + px];
                                    const tVal = sPointsVal[p];
                                    sum += val;
                                    sumSq += val * val;
                                    dotRaw += tVal * val;
                                    sumTpl += tVal;
                                    overlap++;
                                }
                            }

                            if (overlap < minFineOverlap) continue;
                            const iStd = sumSq - (sum * sum) / overlap;
                            if (iStd < 50) continue;

                            const dot = dotRaw - (sum / overlap) * sumTpl;
                            const zncc = dot / (sStd * Math.sqrt(iStd));
                            const isSignificantScaleDeviation = (s <= (1.0 - MARVEL_SNAP_LOGO_SPEC.SCALE_DEVIATION_THRESHOLD) || s >= (1.0 + MARVEL_SNAP_LOGO_SPEC.SCALE_DEVIATION_THRESHOLD));
                            const minDelta = isSignificantScaleDeviation ? MARVEL_SNAP_LOGO_SPEC.MIN_SCALE_IMPROVEMENT_DELTA : MARVEL_SNAP_LOGO_SPEC.MIN_SCALE_IMPROVEMENT_MINOR;
                            if (isFinite(zncc) && zncc > bestFineZNCC && (zncc - scale1ZNCC >= minDelta)) {
                                bestFineZNCC = zncc;
                                bestFineX = cx;
                                bestFineY = cy;
                                bestScale = s;
                            }
                        }
                    }
                }
            }

            // MAP Centering Prior: penalize horizontal drift from expected card center
            const expBaseX = Math.round((cW - tpl.sw * bestScale) / 2);
            const dx = Math.abs(bestFineX - expBaseX);
            const excessDx = Math.max(0, dx - MARVEL_SNAP_LOGO_SPEC.CENTERING_DEADBAND_PX);
            const centerPenalty = excessDx > 0 ? excessDx * MARVEL_SNAP_LOGO_SPEC.CENTERING_PENALTY_RATE : 0;

            // MAP Physical Baseline Prior:
            // Standard cards rest at baseline ~ 302..320 depending on logo height (sh).
            const actualBaseline = bestFineY + Math.round(tpl.sh * bestScale);
            const minAllowed = MARVEL_SNAP_LOGO_SPEC.BASELINE_MIN_PX;
            const maxAllowed = MARVEL_SNAP_LOGO_SPEC.BASELINE_MAX_BASE_PX + Math.max(0, (tpl.sh - 60) * MARVEL_SNAP_LOGO_SPEC.BASELINE_HEIGHT_SLOPE);
            let baselinePenalty = 0;
            if (actualBaseline < minAllowed) {
                baselinePenalty = (minAllowed - actualBaseline) * MARVEL_SNAP_LOGO_SPEC.BASELINE_PENALTY_RATE;
            } else if (actualBaseline > maxAllowed) {
                baselinePenalty = (actualBaseline - maxAllowed) * MARVEL_SNAP_LOGO_SPEC.BASELINE_PENALTY_RATE;
            }

            const validZNCC = isFinite(bestFineZNCC) && bestFineZNCC > 0 ? bestFineZNCC : 0;
            const finalScore = Math.max(0, validZNCC - centerPenalty - baselinePenalty);

            fineResults.push({
                card: {
                    cardDefId: tpl.defId,
                    name: tpl.name,
                    cost: tpl.cost,
                    power: tpl.power
                },
                score: finalScore,
                rawZNCC: bestFineZNCC,
                bestScale,
                coarseScore: cand.item.coarseZNCC,
                x: bestFineX,
                y: bestFineY
            });
        }

        fineResults.sort((a, b) => b.score - a.score);
        return fineResults;
    }

    /**
     * WebAssembly + SIMD accelerated card matching implementation
     */
    matchCardWasm(cardCanvas, targetCost = null, targetPower = null) {
        const cCtx = cardCanvas.getContext('2d');
        const cImg = cCtx.getImageData(0, 0, cardCanvas.width, cardCanvas.height).data;
        const cW = cardCanvas.width;
        const cH = cardCanvas.height;
        const dW = Math.round(cW / 2);
        const dH = Math.round(cH / 2);

        const cardGray = this.wasmCardGray;
        for (let i = 0; i < cW * cH; i++) {
            const idx = i << 2;
            cardGray[i] = 0.299 * cImg[idx] + 0.587 * cImg[idx + 1] + 0.114 * cImg[idx + 2];
        }

        const downGray = this.wasmDownGray;
        for (let y = 0; y < dH; y++) {
            const y0 = y * 2;
            const y1 = Math.min(cH - 1, y0 + 1);
            const dstRow = y * dW;
            for (let x = 0; x < dW; x++) {
                const x0 = x * 2;
                const x1 = Math.min(cW - 1, x0 + 1);
                downGray[dstRow + x] = (
                    cardGray[y0 * cW + x0] +
                    cardGray[y0 * cW + x1] +
                    cardGray[y1 * cW + x0] +
                    cardGray[y1 * cW + x1]
                ) * 0.25;
            }
        }

        // Stage 1: Fast Coarse Screening in WASM across all templates
        const coarseScores = [];
        const wasm = this.wasm;
        for (let i = 0; i < this.templates.length; i++) {
            const tpl = this.templates[i];
            const cw = tpl.cw, ch = tpl.ch;
            const expCY = Math.round(156 - ch);
            const minCY = Math.max(65, expCY - 18);
            const maxCY = Math.min(dH - Math.round(ch * 0.70), expCY + 18);
            const baseX1 = Math.round((dW - cw) / 2);

            const score = wasm.searchCoarse(
                cw, ch, minCY, maxCY, baseX1,
                tpl.cCount,
                tpl.cOffsetsPtr,
                tpl.cPointsXPtr,
                tpl.cPointsYPtr,
                tpl.cPointsValPtr,
                tpl.cStd
            );
            coarseScores.push({
                tpl,
                coarseZNCC: score,
                bestCX: wasm.getOutCX(),
                bestCY: wasm.getOutCY(),
                bestScale: 1.0
            });
        }

        coarseScores.sort((a, b) => b.coarseZNCC - a.coarseZNCC);
        const topCandidates = coarseScores.slice(0, 300);

        // Stage 2: Fine Refinement Scale 1.0 in WASM
        const intermediate = [];
        let maxObservedScore = 0;
        const scratchOff = this.scratchOffsets;
        const scratchX = this.scratchX;
        const scratchY = this.scratchY;
        const scratchVal = this.scratchVal;
        const maxBaselineY = MARVEL_SNAP_LOGO_SPEC.LOGO_BASELINE_MAX_Y;

        for (let i = 0; i < topCandidates.length; i++) {
            const item = topCandidates[i];
            const tpl = item.tpl;
            const fineBaseX = item.bestCX * 2;
            const fineBaseY = item.bestCY * 2;

            scratchOff.set(tpl.sOffsets);
            scratchX.set(tpl.sPointsX);
            scratchY.set(tpl.sPointsY);
            scratchVal.set(tpl.sPointsVal);

            const score = wasm.searchFineScale1(
                tpl.sw, tpl.sh,
                fineBaseX, fineBaseY,
                maxBaselineY,
                tpl.sCount,
                this.FINE_OFF_PTR,
                this.FINE_X_PTR,
                this.FINE_Y_PTR,
                this.FINE_VAL_PTR,
                tpl.sInvStd,
                tpl.sSumTpl
            );

            if (score > maxObservedScore) maxObservedScore = score;
            intermediate.push({
                tpl,
                item,
                bestFineZNCC: score,
                bestFineX: wasm.getOutCX(),
                bestFineY: wasm.getOutCY(),
                scale1ZNCC: score,
                bestScale: 1.0
            });
        }

        // Stage 3: Universal multi-scale using WASM SIMD auto-scaling
        const trigger = Math.max(
            MARVEL_SNAP_LOGO_SPEC.MULTI_SCALE_TRIGGER_ZNCC,
            maxObservedScore - MARVEL_SNAP_LOGO_SPEC.MULTI_SCALE_MAX_DELTA_FROM_LEADER
        );
        const fineResults = [];
        for (let i = 0; i < intermediate.length; i++) {
            const cand = intermediate[i];
            const tpl = cand.tpl;
            let bestFineZNCC = cand.bestFineZNCC;
            let bestFineX = cand.bestFineX;
            let bestFineY = cand.bestFineY;
            let bestScale = cand.bestScale;
            const scale1ZNCC = cand.scale1ZNCC;

            if (bestFineZNCC >= trigger) {
                scratchOff.set(tpl.sOffsets);
                scratchX.set(tpl.sPointsX);
                scratchY.set(tpl.sPointsY);
                scratchVal.set(tpl.sPointsVal);

                for (const s of MARVEL_SNAP_LOGO_SPEC.SCALES) {
                    const scaledW = Math.round(tpl.sw * s);
                    const fineBaseX = Math.round((cW - scaledW) / 2);
                    const fineBaseY = (cand.bestFineY > 0) ? cand.bestFineY : (cand.item.bestCY * 2);

                    const score = wasm.searchFineScaleAuto(
                        tpl.sw, tpl.sh,
                        fineBaseX, fineBaseY,
                        maxBaselineY,
                        s,
                        tpl.sCount,
                        this.FINE_X_PTR, this.FINE_Y_PTR,
                        this.SCALED_X_PTR, this.SCALED_Y_PTR,
                        this.FINE_VAL_PTR,
                        tpl.sStd
                    );

                    const isSignificant = (s <= (1.0 - MARVEL_SNAP_LOGO_SPEC.SCALE_DEVIATION_THRESHOLD) || s >= (1.0 + MARVEL_SNAP_LOGO_SPEC.SCALE_DEVIATION_THRESHOLD));
                    const minDelta = isSignificant ? MARVEL_SNAP_LOGO_SPEC.MIN_SCALE_IMPROVEMENT_DELTA : MARVEL_SNAP_LOGO_SPEC.MIN_SCALE_IMPROVEMENT_MINOR;
                    if (score > bestFineZNCC && (score - scale1ZNCC >= minDelta)) {
                        bestFineZNCC = score;
                        bestFineX = wasm.getOutCX();
                        bestFineY = wasm.getOutCY();
                        bestScale = s;
                    }
                }
            }

            // MAP Centering Prior: penalize horizontal drift from expected card center
            const expBaseX = Math.round((cW - tpl.sw * bestScale) / 2);
            const dx = Math.abs(bestFineX - expBaseX);
            const excessDx = Math.max(0, dx - MARVEL_SNAP_LOGO_SPEC.CENTERING_DEADBAND_PX);
            const centerPenalty = excessDx > 0 ? excessDx * MARVEL_SNAP_LOGO_SPEC.CENTERING_PENALTY_RATE : 0;

            // MAP Physical Baseline Prior:
            // Standard cards rest at baseline ~ 302..320 depending on logo height (sh).
            const actualBaseline = bestFineY + Math.round(tpl.sh * bestScale);
            const minAllowed = MARVEL_SNAP_LOGO_SPEC.BASELINE_MIN_PX;
            const maxAllowed = MARVEL_SNAP_LOGO_SPEC.BASELINE_MAX_BASE_PX + Math.max(0, (tpl.sh - 60) * MARVEL_SNAP_LOGO_SPEC.BASELINE_HEIGHT_SLOPE);
            let baselinePenalty = 0;
            if (actualBaseline < minAllowed) {
                baselinePenalty = (minAllowed - actualBaseline) * MARVEL_SNAP_LOGO_SPEC.BASELINE_PENALTY_RATE;
            } else if (actualBaseline > maxAllowed) {
                baselinePenalty = (actualBaseline - maxAllowed) * MARVEL_SNAP_LOGO_SPEC.BASELINE_PENALTY_RATE;
            }

            const validZNCC = isFinite(bestFineZNCC) && bestFineZNCC > 0 ? bestFineZNCC : 0;
            const finalScore = Math.max(0, validZNCC - centerPenalty - baselinePenalty);

            fineResults.push({
                card: {
                    cardDefId: tpl.defId,
                    name: tpl.name,
                    cost: tpl.cost,
                    power: tpl.power
                },
                score: finalScore,
                rawZNCC: bestFineZNCC,
                bestScale,
                coarseScore: cand.item.coarseZNCC,
                x: bestFineX,
                y: bestFineY
            });
        }

        fineResults.sort((a, b) => b.score - a.score);
        return fineResults;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LogoMatcher };
}

