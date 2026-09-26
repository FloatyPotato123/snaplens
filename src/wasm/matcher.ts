// WebAssembly SIMD ZNCC Matcher for Marvel Snap
// Memory Map:
// 0 .. 80639: downGray (120x168 floats = 20160 * 4 bytes)
// 81920 .. 404479: cardGray (240x336 floats = 80640 * 4 bytes)
// 409600 .. : Dynamic heap for template point arrays

const DOWN_GRAY_OFFSET: usize = 0;
const CARD_GRAY_OFFSET: usize = 81920;
const DYNAMIC_HEAP_OFFSET: usize = 409600;

export function getDownGrayPtr(): usize { return DOWN_GRAY_OFFSET; }
export function getCardGrayPtr(): usize { return CARD_GRAY_OFFSET; }
export function getDynamicHeapPtr(): usize { return DYNAMIC_HEAP_OFFSET; }

// Result registers
let outZNCC: f32 = -1.0;
let outCX: i32 = 0;
let outCY: i32 = 0;
let outScale: f32 = 1.0;

export function getOutZNCC(): f32 { return outZNCC; }
export function getOutCX(): i32 { return outCX; }
export function getOutCY(): i32 { return outCY; }
export function getOutScale(): f32 { return outScale; }

// 1. Stage 1: Coarse Grid Search with 1px Local Peak Refinement
export function searchCoarse(
    cw: i32,
    ch: i32,
    minCY: i32,
    maxCY: i32,
    baseX1: i32,
    cCount: i32,
    cOffsetsPtr: usize,
    cPointsXPtr: usize,
    cPointsYPtr: usize,
    cPointsValPtr: usize,
    cStd: f32
): f32 {
    const dW: i32 = 120;
    const dH: i32 = 168;
    const cCount4: i32 = cCount - (cCount & 3);
    const minOverlap: f32 = <f32>cCount * 0.60;

    let bestZNCC: f32 = -1.0;
    let bestCX: i32 = baseX1;
    let bestCY: i32 = minCY;

    // Stride-2 coarse grid search
    for (let cy = minCY; cy <= maxCY; cy += 2) {
        const cyInside = (cy >= 0 && cy + ch < dH);
        const rowOffset = cy * dW;
        for (let cx = baseX1 - 8; cx <= baseX1 + 8; cx += 2) {
            const baseIdx = rowOffset + cx;
            let sum: f32 = 0;
            let sumSq: f32 = 0;
            let dotRaw: f32 = 0;
            let sumTpl: f32 = 0;
            let overlap: f32 = 0;

            if (cyInside && cx >= 0 && cx + cw < dW) {
                for (let p = 0; p < cCount4; p += 4) {
                    const off0 = load<i32>(cOffsetsPtr + (p << 2));
                    const off1 = load<i32>(cOffsetsPtr + ((p + 1) << 2));
                    const off2 = load<i32>(cOffsetsPtr + ((p + 2) << 2));
                    const off3 = load<i32>(cOffsetsPtr + ((p + 3) << 2));

                    const v0 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off0) << 2));
                    const v1 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off1) << 2));
                    const v2 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off2) << 2));
                    const v3 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off3) << 2));

                    sum += v0 + v1 + v2 + v3;
                    sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;

                    const t0 = load<f32>(cPointsValPtr + (p << 2));
                    const t1 = load<f32>(cPointsValPtr + ((p + 1) << 2));
                    const t2 = load<f32>(cPointsValPtr + ((p + 2) << 2));
                    const t3 = load<f32>(cPointsValPtr + ((p + 3) << 2));

                    dotRaw += t0 * v0 + t1 * v1 + t2 * v2 + t3 * v3;
                }
                for (let p = cCount4; p < cCount; p++) {
                    const off = load<i32>(cOffsetsPtr + (p << 2));
                    const v = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off) << 2));
                    const t = load<f32>(cPointsValPtr + (p << 2));
                    sum += v;
                    sumSq += v * v;
                    dotRaw += t * v;
                }
                overlap = <f32>cCount;
            } else {
                for (let p = 0; p < cCount; p++) {
                    const px = cx + <i32>load<i16>(cPointsXPtr + (p << 1));
                    const py = cy + <i32>load<i16>(cPointsYPtr + (p << 1));
                    if (px >= 0 && px < dW && py >= 0 && py < dH) {
                        const off = load<i32>(cOffsetsPtr + (p << 2));
                        const v = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off) << 2));
                        const t = load<f32>(cPointsValPtr + (p << 2));
                        sum += v;
                        sumSq += v * v;
                        dotRaw += t * v;
                        sumTpl += t;
                        overlap += 1.0;
                    }
                }
                if (overlap < minOverlap) continue;
            }

            const dot = dotRaw - (sum / overlap) * sumTpl;
            if (dot <= 0) continue;

            const iStd = sumSq - (sum * sum) / overlap;
            if (iStd < 25.0) continue;

            const zncc = dot / (cStd * Mathf.sqrt(iStd));
            if (zncc > bestZNCC) {
                bestZNCC = zncc;
                bestCX = cx;
                bestCY = cy;
            }
        }
    }

    // Local 1px peak refinement
    if (bestZNCC > 0.10) {
        const anchorCX = bestCX;
        const anchorCY = bestCY;
        for (let dcy = -1; dcy <= 1; dcy++) {
            const cy = anchorCY + dcy;
            if (cy < minCY || cy > maxCY) continue;
            const cyInside = (cy >= 0 && cy + ch < dH);
            const rowOffset = cy * dW;
            for (let dcx = -1; dcx <= 1; dcx++) {
                if (dcx == 0 && dcy == 0) continue;
                const cx = anchorCX + dcx;
                if (cx < baseX1 - 8 || cx > baseX1 + 8) continue;
                const baseIdx = rowOffset + cx;
                let sum: f32 = 0;
                let sumSq: f32 = 0;
                let dotRaw: f32 = 0;
                let sumTpl: f32 = 0;
                let overlap: f32 = 0;

                if (cyInside && cx >= 0 && cx + cw < dW) {
                    for (let p = 0; p < cCount4; p += 4) {
                        const off0 = load<i32>(cOffsetsPtr + (p << 2));
                        const off1 = load<i32>(cOffsetsPtr + ((p + 1) << 2));
                        const off2 = load<i32>(cOffsetsPtr + ((p + 2) << 2));
                        const off3 = load<i32>(cOffsetsPtr + ((p + 3) << 2));

                        const v0 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off0) << 2));
                        const v1 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off1) << 2));
                        const v2 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off2) << 2));
                        const v3 = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off3) << 2));

                        sum += v0 + v1 + v2 + v3;
                        sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;

                        const t0 = load<f32>(cPointsValPtr + (p << 2));
                        const t1 = load<f32>(cPointsValPtr + ((p + 1) << 2));
                        const t2 = load<f32>(cPointsValPtr + ((p + 2) << 2));
                        const t3 = load<f32>(cPointsValPtr + ((p + 3) << 2));

                        dotRaw += t0 * v0 + t1 * v1 + t2 * v2 + t3 * v3;
                    }
                    for (let p = cCount4; p < cCount; p++) {
                        const off = load<i32>(cOffsetsPtr + (p << 2));
                        const v = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off) << 2));
                        const t = load<f32>(cPointsValPtr + (p << 2));
                        sum += v;
                        sumSq += v * v;
                        dotRaw += t * v;
                    }
                    overlap = <f32>cCount;
                } else {
                    for (let p = 0; p < cCount; p++) {
                        const px = cx + <i32>load<i16>(cPointsXPtr + (p << 1));
                        const py = cy + <i32>load<i16>(cPointsYPtr + (p << 1));
                        if (px >= 0 && px < dW && py >= 0 && py < dH) {
                            const off = load<i32>(cOffsetsPtr + (p << 2));
                            const v = load<f32>(DOWN_GRAY_OFFSET + ((baseIdx + off) << 2));
                            const t = load<f32>(cPointsValPtr + (p << 2));
                            sum += v;
                            sumSq += v * v;
                            dotRaw += t * v;
                            sumTpl += t;
                            overlap += 1.0;
                        }
                    }
                    if (overlap < minOverlap) continue;
                }

                const dot = dotRaw - (sum / overlap) * sumTpl;
                if (dot <= 0) continue;

                const iStd = sumSq - (sum * sum) / overlap;
                if (iStd < 25.0) continue;

                const zncc = dot / (cStd * Mathf.sqrt(iStd));
                if (zncc > bestZNCC) {
                    bestZNCC = zncc;
                    bestCX = cx;
                    bestCY = cy;
                }
            }
        }
    }

    outZNCC = bestZNCC;
    outCX = bestCX;
    outCY = bestCY;
    return bestZNCC;
}

// 2. Stage 2: Fine Refinement at Scale 1.0
export function searchFineScale1(
    sw: i32,
    sh: i32,
    fineBaseX: i32,
    fineBaseY: i32,
    maxBaselineY: i32,
    sCount: i32,
    sOffsetsPtr: usize,
    sPointsXPtr: usize,
    sPointsYPtr: usize,
    sPointsValPtr: usize,
    sInvStd: f32,
    sSumTpl: f32
): f32 {
    const cW: i32 = 240;
    const cH: i32 = 336;
    const sCount4: i32 = sCount - (sCount & 3);
    const minFineOverlap: f32 = <f32>sCount * 0.65;

    let bestFineZNCC: f32 = -1.0;
    let bestFineX: i32 = fineBaseX;
    let bestFineY: i32 = fineBaseY;

    for (let cy = fineBaseY - 2; cy <= fineBaseY + 2; cy++) {
        if (cy + sh > maxBaselineY) continue;
        const cyInside = (cy >= 0 && cy + sh < cH);
        const rowOffset = cy * cW;
        for (let cx = fineBaseX - 2; cx <= fineBaseX + 2; cx++) {
            let sum: f32 = 0;
            let sumSq: f32 = 0;
            let dotRaw: f32 = 0;
            let sumTpl: f32 = 0;
            let overlap: f32 = 0;

            if (cyInside && cx >= 0 && cx + sw < cW) {
                const baseIdx = rowOffset + cx;
                for (let p = 0; p < sCount4; p += 4) {
                    const off0 = load<i32>(sOffsetsPtr + (p << 2));
                    const off1 = load<i32>(sOffsetsPtr + ((p + 1) << 2));
                    const off2 = load<i32>(sOffsetsPtr + ((p + 2) << 2));
                    const off3 = load<i32>(sOffsetsPtr + ((p + 3) << 2));

                    const v0 = load<f32>(CARD_GRAY_OFFSET + ((baseIdx + off0) << 2));
                    const v1 = load<f32>(CARD_GRAY_OFFSET + ((baseIdx + off1) << 2));
                    const v2 = load<f32>(CARD_GRAY_OFFSET + ((baseIdx + off2) << 2));
                    const v3 = load<f32>(CARD_GRAY_OFFSET + ((baseIdx + off3) << 2));

                    sum += v0 + v1 + v2 + v3;
                    sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;

                    const t0 = load<f32>(sPointsValPtr + (p << 2));
                    const t1 = load<f32>(sPointsValPtr + ((p + 1) << 2));
                    const t2 = load<f32>(sPointsValPtr + ((p + 2) << 2));
                    const t3 = load<f32>(sPointsValPtr + ((p + 3) << 2));

                    dotRaw += t0 * v0 + t1 * v1 + t2 * v2 + t3 * v3;
                }
                for (let p = sCount4; p < sCount; p++) {
                    const off = load<i32>(sOffsetsPtr + (p << 2));
                    const v = load<f32>(CARD_GRAY_OFFSET + ((baseIdx + off) << 2));
                    const t = load<f32>(sPointsValPtr + (p << 2));
                    sum += v;
                    sumSq += v * v;
                    dotRaw += t * v;
                }
                sumTpl = sSumTpl;
                overlap = <f32>sCount;
            } else {
                for (let p = 0; p < sCount; p++) {
                    const px = cx + <i32>load<i16>(sPointsXPtr + (p << 1));
                    const py = cy + <i32>load<i16>(sPointsYPtr + (p << 1));
                    if (px >= 0 && px < cW && py >= 0 && py < cH) {
                        const v = load<f32>(CARD_GRAY_OFFSET + ((py * cW + px) << 2));
                        const t = load<f32>(sPointsValPtr + (p << 2));
                        sum += v;
                        sumSq += v * v;
                        dotRaw += t * v;
                        sumTpl += t;
                        overlap += 1.0;
                    }
                }
                if (overlap < minFineOverlap) continue;
            }

            const dot = dotRaw - (sum / overlap) * sumTpl;
            if (dot <= 0) continue;

            const iStd = sumSq - (sum * sum) / overlap;
            if (iStd < 50.0) continue;

            const zncc = (dot * sInvStd) / Mathf.sqrt(iStd);
            if (zncc > bestFineZNCC) {
                bestFineZNCC = zncc;
                bestFineX = cx;
                bestFineY = cy;
            }
        }
    }

    outZNCC = bestFineZNCC;
    outCX = bestFineX;
    outCY = bestFineY;
    outScale = 1.0;
    return bestFineZNCC;
}

// 3. Stage 3: Fine Search at Arbitrary Scale
export function searchFineScale(
    scaledW: i32,
    scaledH: i32,
    fineBaseX: i32,
    fineBaseY: i32,
    maxBaselineY: i32,
    scale: f32,
    sCount: i32,
    scaledXPtr: usize,
    scaledYPtr: usize,
    sPointsValPtr: usize,
    sStd: f32
): f32 {
    const cW: i32 = 240;
    const cH: i32 = 336;
    const minFineOverlap: f32 = <f32>sCount * 0.65;

    let bestZNCC: f32 = -1.0;
    let bestX: i32 = fineBaseX;
    let bestY: i32 = fineBaseY;

    for (let cy = fineBaseY - 2; cy <= fineBaseY + 2; cy++) {
        if (cy + scaledH > maxBaselineY) continue;
        for (let cx = fineBaseX - 4; cx <= fineBaseX + 4; cx++) {
            let sum: f32 = 0;
            let sumSq: f32 = 0;
            let dotRaw: f32 = 0;
            let sumTpl: f32 = 0;
            let overlap: f32 = 0;

            for (let p = 0; p < sCount; p++) {
                const px = cx + <i32>load<i16>(scaledXPtr + (p << 1));
                const py = cy + <i32>load<i16>(scaledYPtr + (p << 1));
                if (px >= 0 && px < cW && py >= 0 && py < cH) {
                    const v = load<f32>(CARD_GRAY_OFFSET + ((py * cW + px) << 2));
                    const t = load<f32>(sPointsValPtr + (p << 2));
                    sum += v;
                    sumSq += v * v;
                    dotRaw += t * v;
                    sumTpl += t;
                    overlap += 1.0;
                }
            }

            if (overlap < minFineOverlap) continue;

            const dot = dotRaw - (sum / overlap) * sumTpl;
            if (dot <= 0) continue;

            const iStd = sumSq - (sum * sum) / overlap;
            if (iStd < 50.0) continue;

            const zncc = dot / (sStd * Mathf.sqrt(iStd));
            if (zncc > bestZNCC) {
                bestZNCC = zncc;
                bestX = cx;
                bestY = cy;
            }
        }
    }

    outZNCC = bestZNCC;
    outCX = bestX;
    outCY = bestY;
    outScale = scale;
    return bestZNCC;
}
