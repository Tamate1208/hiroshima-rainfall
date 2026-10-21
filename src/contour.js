// --- Marching Squares コンター生成 (src/contour.js) ---

import * as turf from '@turf/turf';
import { GRID, LON_STEP, LAT_STEP } from './constants.js';

function joinSegments(segments) {
    const lines = [];
    const remaining = [...segments];
    const isSame = (p1, p2) => Math.abs(p1[0]-p2[0]) < 1e-7 && Math.abs(p1[1]-p2[1]) < 1e-7;

    while (remaining.length > 0) {
        let line = remaining.shift();
        let added = true;
        while (added) {
            added = false;
            const tail = line[line.length - 1];
            const head = line[0];
            for (let i = 0; i < remaining.length; i++) {
                const seg = remaining[i];
                if (isSame(tail, seg[0])) { line.push(seg[1]); remaining.splice(i,1); added=true; break; }
                if (isSame(tail, seg[1])) { line.push(seg[0]); remaining.splice(i,1); added=true; break; }
                if (isSame(head, seg[0])) { line.unshift(seg[1]); remaining.splice(i,1); added=true; break; }
                if (isSame(head, seg[1])) { line.unshift(seg[0]); remaining.splice(i,1); added=true; break; }
            }
        }
        lines.push(line);
    }
    return lines;
}

/**
 * Chaikin のコーナースムージング
 * 元の折れ線の凸包の内側に厳密に収まるため、ベジェスプラインのような外側への飛び出し（オーバーシュート）が原理的に起きない
 */
function chaikinSmooth(points, iterations = 2) {
    if (points.length < 3) return points;
    let current = points;
    for (let it = 0; it < iterations; it++) {
        const next = [];
        const isClosed = Math.abs(current[0][0] - current[current.length - 1][0]) < 1e-7 &&
                         Math.abs(current[0][1] - current[current.length - 1][1]) < 1e-7;
        
        if (isClosed) {
            for (let i = 0; i < current.length - 1; i++) {
                const p0 = current[i];
                const p1 = current[i + 1];
                next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
                next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
            }
            next.push([...next[0]]);
        } else {
            next.push(current[0]);
            for (let i = 0; i < current.length - 1; i++) {
                const p0 = current[i];
                const p1 = current[i + 1];
                next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
                next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
            }
            next.push(current[current.length - 1]);
        }
        current = next;
    }
    return current;
}

export function getIsolines(grid, thresholds) {
    const results = [];
    const { cols, rows } = GRID;

    thresholds.forEach(threshold => {
        const rawSegments = [];

        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const v0 = grid[r * cols + c];
                const v1 = grid[r * cols + (c+1)];
                const v2 = grid[(r+1) * cols + (c+1)];
                const v3 = grid[(r+1) * cols + c];

                let state = 0;
                if (v0 >= threshold) state |= 8;
                if (v1 >= threshold) state |= 4;
                if (v2 >= threshold) state |= 2;
                if (v3 >= threshold) state |= 1;
                if (state === 0 || state === 15) continue;

                const p0 = [c + (threshold - v0) / (v1 - v0), r];
                const p1 = [c+1, r + (threshold - v1) / (v2 - v1)];
                const p2 = [c + (threshold - v3) / (v2 - v3), r+1];
                const p3 = [c, r + (threshold - v0) / (v3 - v0)];

                const line = [];
                switch (state) {
                    case 1: case 14: line.push([p2, p3]); break;
                    case 2: case 13: line.push([p1, p2]); break;
                    case 3: case 12: line.push([p1, p3]); break;
                    case 4: case 11: line.push([p0, p1]); break;
                    case 5:  line.push([p0, p1], [p2, p3]); break;
                    case 10: line.push([p0, p3], [p1, p2]); break;
                    case 6: case 9:  line.push([p0, p2]); break;
                    case 7: case 8:  line.push([p0, p3]); break;
                }

                line.forEach(seg => {
                    rawSegments.push(seg.map(pt => [
                        GRID.minLon + pt[0] * LON_STEP,
                        GRID.maxLat - pt[1] * LAT_STEP
                    ]));
                });
            }
        }

        if (rawSegments.length > 0) {
            const joined = joinSegments(rawSegments);
            const smoothed = joined.map(pts => chaikinSmooth(pts, 2));
            results.push({ value: threshold, segments: smoothed });
        }
    });
    return results;
}
