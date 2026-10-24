// --- TPS 補間 (src/interpolation.js) ---
// Phase 1-B: キャッシュキーに重心座標を追加し、モード切替時の誤再利用を防止

import * as turf from '@turf/turf';
import { GRID, LON_STEP, LAT_STEP, TPS_CONFIG, CONVEX_BUFFER_KM, DECAY, IDW_UPPER_MARGIN, IDW_POWER, IDW_EPSILON } from './constants.js';

export function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function tpsU(r) {
    if (r < 1e-10) return 0;
    return r * r * Math.log(r);
}

function lupDecompose(A) {
    const n = A.length;
    const LU = A.map(row => Float64Array.from(row));
    const P = new Int32Array(n);
    for (let i = 0; i < n; i++) P[i] = i;

    for (let i = 0; i < n; i++) {
        let maxVal = 0, pRow = i;
        for (let k = i; k < n; k++) {
            const abs = Math.abs(LU[k][i]);
            if (abs > maxVal) { maxVal = abs; pRow = k; }
        }
        if (maxVal < 1e-12) continue;
        if (pRow !== i) {
            const tmpRow = LU[i]; LU[i] = LU[pRow]; LU[pRow] = tmpRow;
            const tmpP = P[i]; P[i] = P[pRow]; P[pRow] = tmpP;
        }
        for (let j = i + 1; j < n; j++) {
            LU[j][i] /= LU[i][i];
            const factor = LU[j][i];
            for (let k = i + 1; k < n; k++) LU[j][k] -= factor * LU[i][k];
        }
    }
    return { LU, P, n };
}

function lupSolve(lup, b) {
    const { LU, P, n } = lup;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let sum = b[P[i]];
        for (let j = 0; j < i; j++) sum -= LU[i][j] * y[j];
        y[i] = sum;
    }
    for (let i = n - 1; i >= 0; i--) {
        let sum = y[i];
        for (let j = i + 1; j < n; j++) sum -= LU[i][j] * x[j];
        x[i] = sum / (LU[i][i] || 1e-12);
    }
    return x;
}

// 近接する局を1つにまとめる (トゲの防止)
export function aggregateStations(stations) {
    const aggregated = [];
    const used = new Set();
    const threshold = TPS_CONFIG.AGGREGATION_KM;

    for (let i = 0; i < stations.length; i++) {
        if (used.has(i)) continue;
        const group = [stations[i]];
        used.add(i);
        for (let j = i + 1; j < stations.length; j++) {
            if (used.has(j)) continue;
            const dist = haversineKm(stations[i].lat, stations[i].lon, stations[j].lat, stations[j].lon);
            if (dist < threshold) { group.push(stations[j]); used.add(j); }
        }
        const count = group.length;
        aggregated.push({
            lat: group.reduce((a, b) => a + b.lat, 0) / count,
            lon: group.reduce((a, b) => a + b.lon, 0) / count,
            value: group.reduce((a, b) => a + b.value, 0) / count
        });
    }
    return aggregated;
}

function buildTpsCoefficients(stations) {
    const N = stations.length;
    const lats = stations.map(s => s.lat);
    const lons = stations.map(s => s.lon);
    const cLat = lats.reduce((a, b) => a + b, 0) / N;
    const cLon = lons.reduce((a, b) => a + b, 0) / N;

    const toX = (lon) => (lon - cLon) * 111.32 * Math.cos(cLat * Math.PI / 180);
    const toY = (lat) => (lat - cLat) * 110.574;
    
    const ptsX = new Float64Array(N);
    const ptsY = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        ptsX[i] = toX(stations[i].lon);
        ptsY[i] = toY(stations[i].lat);
    }

    const size = N + 3;
    const A = Array.from({ length: size }, () => new Float64Array(size));
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const dx = ptsX[i] - ptsX[j];
            const dy = ptsY[i] - ptsY[j];
            A[i][j] = tpsU(Math.sqrt(dx*dx + dy*dy));
        }
        A[i][i] += TPS_CONFIG.LAMBDA;
        A[i][N] = 1; A[i][N+1] = ptsX[i]; A[i][N+2] = ptsY[i];
        A[N][i] = 1; A[N+1][i] = ptsX[i]; A[N+2][i] = ptsY[i];
    }

    // 初回に一度だけLUP分解を実行
    const lup = lupDecompose(A);

    // グリッド座標LUT（Look Up Table）を事前計算
    const gridPx = new Float64Array(GRID.cols);
    for (let c = 0; c < GRID.cols; c++) {
        gridPx[c] = toX(GRID.minLon + (c + 0.5) * LON_STEP);
    }
    const gridPy = new Float64Array(GRID.rows);
    for (let r = 0; r < GRID.rows; r++) {
        gridPy[r] = toY(GRID.maxLat - (r + 0.5) * LAT_STEP);
    }

    // 外挿域マスク: 観測局の凸包 + バッファ外判定を一度だけ事前グリッド化
    const stationPts = turf.points(stations.map(s => [s.lon, s.lat]));
    const hullFeature = turf.convex(stationPts);
    const maskPoly = hullFeature ? turf.buffer(hullFeature, CONVEX_BUFFER_KM, { units: 'kilometers' }) : null;

    const maskGrid = new Uint8Array(GRID.rows * GRID.cols);
    for (let r = 0; r < GRID.rows; r++) {
        const lat = GRID.maxLat - (r + 0.5) * LAT_STEP;
        for (let c = 0; c < GRID.cols; c++) {
            const lon = GRID.minLon + (c + 0.5) * LON_STEP;
            if (maskPoly && turf.booleanPointInPolygon([lon, lat], maskPoly)) {
                maskGrid[r * GRID.cols + c] = 1;
            }
        }
    }

    return { lup, ptsX, ptsY, N, size, gridPx, gridPy, maskGrid };
}

// キャッシュキーを N + 重心座標で管理
let _tpsCache = null;

export function buildSmoothGrid(rawStations) {
    const stations = aggregateStations(rawStations);
    const grid = new Float32Array(GRID.cols * GRID.rows);
    if (stations.length < 3) return grid;

    const N = stations.length;

    const centerLat = stations.reduce((s, p) => s + p.lat, 0) / N;
    const centerLon = stations.reduce((s, p) => s + p.lon, 0) / N;
    const cacheKey = `${N}_${centerLat.toFixed(4)}_${centerLon.toFixed(4)}`;

    if (!_tpsCache || _tpsCache.key !== cacheKey) {
        _tpsCache = { ...buildTpsCoefficients(stations), key: cacheKey };
    }
    const { lup, ptsX, ptsY, size, gridPx, gridPy, maskGrid } = _tpsCache;

    // 前進代入・後退代入のみで重み係数 w を瞬時に算出（0.2ms）
    const b = new Float64Array(size);
    const stationValues = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        b[i] = stations[i].value;
        stationValues[i] = stations[i].value;
    }
    const w = lupSolve(lup, b);

    const decayFactor = Math.PI / (DECAY.END_KM - DECAY.START_KM);

    for (let r = 0; r < GRID.rows; r++) {
        const py = gridPy[r];
        const rowOffset = r * GRID.cols;
        for (let c = 0; c < GRID.cols; c++) {
            const idx = rowOffset + c;
            if (!maskGrid[idx]) {
                grid[idx] = 0;
                continue;
            }

            const px = gridPx[c];
            let val = w[N] + w[N+1] * px + w[N+2] * py;
            let minDist = Infinity;
            let idwNum = 0, idwDen = 0;

            for (let i = 0; i < N; i++) {
                const dx = px - ptsX[i];
                const dy = py - ptsY[i];
                const d2 = dx * dx + dy * dy;
                const d = Math.sqrt(d2);
                val += w[i] * tpsU(d);
                if (d < minDist) minDist = d;
                const wi = 1.0 / (d2 + IDW_EPSILON);
                idwNum += wi * stationValues[i];
                idwDen += wi;
            }

            const idwUpper = idwDen > 0 ? (idwNum / idwDen) * IDW_UPPER_MARGIN : 0;
            val = Math.max(0, Math.min(val, idwUpper));

            // 観測局からの最近傍距離 minDist に基づく滑らかなコサイン減衰（外郭ぼかし）
            let decay = 1.0;
            if (minDist > DECAY.START_KM) {
                if (minDist >= DECAY.END_KM) {
                    decay = 0.0;
                } else {
                    const t = minDist - DECAY.START_KM;
                    decay = 0.5 * (1.0 + Math.cos(t * decayFactor));
                }
            }

            grid[idx] = val * decay;
        }
    }
    return grid;
}
