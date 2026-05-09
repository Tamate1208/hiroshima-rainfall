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

function gaussianElimination(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let maxRow = col;
        let maxVal = Math.abs(M[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > maxVal) {
                maxVal = Math.abs(M[row][col]);
                maxRow = row;
            }
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        if (Math.abs(M[col][col]) < 1e-12) continue;
        for (let row = col + 1; row < n; row++) {
            const factor = M[row][col] / M[col][col];
            for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
        }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = M[i][n];
        for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
        x[i] /= M[i][i] || 1e-12;
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
    const pts = stations.map(s => ({ x: toX(s.lon), y: toY(s.lat) }));

    const size = N + 3;
    const A = Array.from({ length: size }, () => new Float64Array(size));
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const dx = pts[i].x - pts[j].x;
            const dy = pts[i].y - pts[j].y;
            A[i][j] = tpsU(Math.sqrt(dx*dx + dy*dy));
        }
        A[i][i] += TPS_CONFIG.LAMBDA;
        A[i][N] = 1; A[i][N+1] = pts[i].x; A[i][N+2] = pts[i].y;
        A[N][i] = 1; A[N+1][i] = pts[i].x; A[N+2][i] = pts[i].y;
    }
    return { A, pts, N, toX, toY, cLat, cLon };
}

// Phase 1-B: キャッシュキーを N + 重心座標で管理
let _tpsCache = null;

export function buildSmoothGrid(rawStations) {
    const stations = aggregateStations(rawStations);
    const grid = new Float32Array(GRID.cols * GRID.rows);
    if (stations.length < 3) return grid;

    const N = stations.length;
    const size = N + 3;

    const centerLat = stations.reduce((s, p) => s + p.lat, 0) / N;
    const centerLon = stations.reduce((s, p) => s + p.lon, 0) / N;
    const cacheKey = `${N}_${centerLat.toFixed(4)}_${centerLon.toFixed(4)}`;

    if (!_tpsCache || _tpsCache.key !== cacheKey) {
        _tpsCache = { ...buildTpsCoefficients(stations), key: cacheKey };
    }
    const { A, pts, toX, toY } = _tpsCache;

    const b = new Float64Array(size);
    for (let i = 0; i < N; i++) b[i] = stations[i].value;
    const w = gaussianElimination(A.map(row => Array.from(row)), Array.from(b));
    const stationValues = stations.map(s => s.value);

    // 外挿域マスク: 観測局の凸包 + バッファ外をゼロ化
    const stationPts = turf.points(stations.map(s => [s.lon, s.lat]));
    const hullFeature = turf.convex(stationPts);
    const maskPoly = hullFeature ? turf.buffer(hullFeature, CONVEX_BUFFER_KM, { units: 'kilometers' }) : null;

    for (let r = 0; r < GRID.rows; r++) {
        const lat = GRID.maxLat - (r + 0.5) * LAT_STEP;
        for (let c = 0; c < GRID.cols; c++) {
            const lon = GRID.minLon + (c + 0.5) * LON_STEP;

            if (maskPoly && !turf.booleanPointInPolygon([lon, lat], maskPoly)) {
                grid[r * GRID.cols + c] = 0;
                continue;
            }

            const px = toX(lon);
            const py = toY(lat);
            let val = w[N] + w[N+1] * px + w[N+2] * py;
            let minDist = Infinity;
            let idwNum = 0, idwDen = 0;

            for (let i = 0; i < N; i++) {
                const dx = px - pts[i].x;
                const dy = py - pts[i].y;
                const d = Math.sqrt(dx*dx + dy*dy);
                val += w[i] * tpsU(d);
                if (d < minDist) minDist = d;
                const wi = 1.0 / (Math.pow(d, IDW_POWER) + IDW_EPSILON);
                idwNum += wi * stationValues[i];
                idwDen += wi;
            }

            const idwUpper = idwDen > 0 ? (idwNum / idwDen) * IDW_UPPER_MARGIN : 0;
            val = Math.max(0, Math.min(val, idwUpper));

            const decay = minDist <= DECAY.START_KM ? 1.0
                        : minDist >= DECAY.END_KM   ? 0.0
                        : 1.0 - (minDist - DECAY.START_KM) / (DECAY.END_KM - DECAY.START_KM);

            grid[r * GRID.cols + c] = val * decay;
        }
    }
    return grid;
}
