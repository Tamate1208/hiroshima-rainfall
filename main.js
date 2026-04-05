// --- Rainfall Visualization System (Hiroshima) ---
// Note: High-Resolution Grid + Thin Plate Spline (TPS) + Marching Squares

import * as turf from "@turf/turf";

let map, rainfallData, markers = [];
let baseLayer;
let currentTimestamp;
let timestamps = [];
let playInterval = null;

// --- 国の災害採択基準雨量 ---
const ADOPTION_CRITERIA = {
    max24: 80,    // mm/24h — 公共土木・農地等
    max60: 20,    // mm/1h
    current: null // リアルタイムモードは基準なし
};

// モード別の等雨量線閾値セット
const THRESHOLDS_BY_MODE = {
    current: [1, 5, 10, 20],
    max60:   [1, 5, 10, 20, 30, 50],
    max24:   [10, 20, 50, 80, 100, 150, 200, 250]
};

// Grid configuration (100x80 for higher quality contours)
const GRID = {
    minLon: 131.8, maxLon: 133.6,
    minLat: 33.9,  maxLat: 35.3,
    cols: 100,
    rows: 80
};
const LON_STEP = (GRID.maxLon - GRID.minLon) / GRID.cols;
const LAT_STEP = (GRID.maxLat - GRID.minLat) / GRID.rows;

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// =============================================================
// --- Regularized Thin Plate Spline (TPS) Interpolation ---
// =============================================================

const TPS_CONFIG = {
    LAMBDA: 1.0,           // 平滑化係数（大きいほど滑らかになる）
    AGGREGATION_KM: 3.0    // 近接局を統合する距離しきい値
};

let _tpsCache = null;

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

// 近接する局を 1 つにまとめる (トゲの防止)
function aggregateStations(stations) {
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
            if (dist < threshold) {
                group.push(stations[j]);
                used.add(j);
            }
        }

        // 平均値を採用
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
    const size = N + 3;
    const lats = stations.map(s => s.lat);
    const lons = stations.map(s => s.lon);
    const cLat = lats.reduce((a, b) => a + b, 0) / N;
    const cLon = lons.reduce((a, b) => a + b, 0) / N;

    const toX = (lon) => (lon - cLon) * 111.32 * Math.cos(cLat * Math.PI / 180);
    const toY = (lat) => (lat - cLat) * 110.574;
    const pts = stations.map(s => ({ x: toX(s.lon), y: toY(s.lat) }));

    const A = Array.from({ length: size }, () => new Float64Array(size));
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const dx = pts[i].x - pts[j].x;
            const dy = pts[i].y - pts[j].y;
            const r = Math.sqrt(dx * dx + dy * dy);
            A[i][j] = tpsU(r);
        }
        // --- Regularization (平滑化ターム) ---
        // 対角成分に LAMBDA を載せることで、
        // スプライン曲面に「硬さ」を与え、ノイズを吸収させる。
        A[i][i] += TPS_CONFIG.LAMBDA;

        A[i][N] = 1; A[i][N+1] = pts[i].x; A[i][N+2] = pts[i].y;
        A[N][i] = 1; A[N+1][i] = pts[i].x; A[N+2][i] = pts[i].y;
    }
    return { A, pts, N, toX, toY };
}

function buildSmoothGrid(rawStations) {
    const stations = aggregateStations(rawStations);
    const grid = new Float32Array(GRID.cols * GRID.rows);
    if (stations.length < 3) return grid;

    const N = stations.length;
    const size = N + 3;

    // 局の点構成が変わったときのみ行列を再構築
    if (!_tpsCache || _tpsCache.N !== N) {
        _tpsCache = buildTpsCoefficients(stations);
    }
    const { A, pts, toX, toY } = _tpsCache;

    const b = new Float64Array(size);
    for (let i = 0; i < N; i++) b[i] = stations[i].value;

    const w = gaussianElimination(A.map(row => Array.from(row)), Array.from(b));
    const stationValues = stations.map(s => s.value);

    // --- 外挿域マスク: 観測局の凸包 + 10kmバッファ外のセルをゼロ化 ---
    // 海上・県外など観測根拠のない領域に等雨量線が延伸するのを防ぐ
    const stationPts = turf.points(stations.map(s => [s.lon, s.lat]));
    const hullFeature = turf.convex(stationPts);
    const maskPoly = hullFeature
        ? turf.buffer(hullFeature, 10, { units: 'kilometers' })
        : null;

    for (let r = 0; r < GRID.rows; r++) {
        const lat = GRID.maxLat - (r + 0.5) * LAT_STEP;
        for (let c = 0; c < GRID.cols; c++) {
            const lon = GRID.minLon + (c + 0.5) * LON_STEP;

            // 観測局の凸包の外側 (外挿域) はゼロに固定
            if (maskPoly && !turf.booleanPointInPolygon([lon, lat], maskPoly)) {
                grid[r * GRID.cols + c] = 0;
                continue;
            }

            const px = toX(lon);
            const py = toY(lat);

            let val = w[N] + w[N + 1] * px + w[N + 2] * py;
            let minDist = Infinity;
            let idwNum = 0, idwDen = 0;

            for (let i = 0; i < N; i++) {
                const dx = px - pts[i].x;
                const dy = py - pts[i].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                val += w[i] * tpsU(d);
                if (d < minDist) minDist = d;
                
                // --- IDWによる局所上限バッファ (少し緩和) ---
                const w_i = 1.0 / (Math.pow(d, 2.5) + 0.1); 
                idwNum += w_i * stationValues[i];
                idwDen += w_i;
            }

            const idwUpper = idwDen > 0 ? (idwNum / idwDen) * 1.1 : 0; // 10% 余裕を持たせる
            val = Math.max(0, Math.min(val, idwUpper));

            const DECAY_START = 20, DECAY_END = 60; // 減衰を少し手前から開始して境界を自然に
            const decay = minDist <= DECAY_START ? 1.0
                        : minDist >= DECAY_END   ? 0.0
                        : 1.0 - (minDist - DECAY_START) / (DECAY_END - DECAY_START);

            grid[r * GRID.cols + c] = val * decay;
        }
    }
    return grid;
}

// --- Marching Squares for Grid-based Isolines ---
function getIsolines(grid, thresholds) {
    const results = [];
    const { cols, rows } = GRID;

    thresholds.forEach(threshold => {
        const rawSegments = [];
        
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const v0 = grid[r * cols + c];
                const v1 = grid[r * cols + (c + 1)];
                const v2 = grid[(r + 1) * cols + (c + 1)];
                const v3 = grid[(r + 1) * cols + c];

                let state = 0;
                if (v0 >= threshold) state |= 8;
                if (v1 >= threshold) state |= 4;
                if (v2 >= threshold) state |= 2;
                if (v3 >= threshold) state |= 1;

                if (state === 0 || state === 15) continue;

                // Interpolated points along grid edges
                const p0 = [c + (threshold - v0) / (v1 - v0), r];
                const p1 = [c + 1, r + (threshold - v1) / (v2 - v1)];
                const p2 = [c + (threshold - v3) / (v2 - v3), r + 1];
                const p3 = [c, r + (threshold - v0) / (v3 - v0)];

                const line = [];
                switch (state) {
                    case 1: case 14: line.push([p2, p3]); break;
                    case 2: case 13: line.push([p1, p2]); break;
                    case 3: case 12: line.push([p1, p3]); break;
                    case 4: case 11: line.push([p0, p1]); break;
                    case 5: line.push([p0, p1], [p2, p3]); break;
                    case 10: line.push([p0, p3], [p1, p2]); break;
                    case 6: case 9: line.push([p0, p2]); break;
                    case 7: case 8: line.push([p0, p3]); break;
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
            const smoothed = joined.map(pts => {
                if (pts.length < 3) return pts;
                try {
                    const line = turf.lineString(pts);
                    const spline = turf.bezierSpline(line, { resolution: 10000, sharpness: 0.8 });
                    return spline.geometry.coordinates;
                } catch (e) {
                    return pts;
                }
            });
            results.push({ value: threshold, segments: smoothed });
        }
    });
    return results;
}

function joinSegments(segments) {
    const lines = [];
    const remaining = [...segments];
    const isSame = (p1, p2) => Math.abs(p1[0]-p2[0])<1e-7 && Math.abs(p1[1]-p2[1])<1e-7;

    while (remaining.length > 0) {
        let line = remaining.shift();
        let added = true;
        while (added) {
            added = false;
            let tail = line[line.length - 1];
            let head = line[0];
            for (let i = 0; i < remaining.length; i++) {
                let seg = remaining[i];
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

async function init() {
    map = L.map('map', { zoomControl: false, attributionControl: false })
            .setView([34.5, 132.8], 10);

    const themes = {
        dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    };

    baseLayer = L.tileLayer(themes.dark).addTo(map);

    document.getElementById('theme-selector').addEventListener('change', (e) => {
        const theme = e.target.value;
        baseLayer.setUrl(themes[theme]);
        if (theme === 'light') document.body.classList.add('light-theme');
        else document.body.classList.remove('light-theme');
    });

    const now = new Date();
    const todayStr = now.getFullYear() + '-' + 
                    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(now.getDate()).padStart(2, '0');
    
    document.getElementById('start-date').value = todayStr;
    document.getElementById('end-date').value = todayStr;
    document.getElementById('current-date').innerText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    await loadData();

    document.getElementById('timeline').addEventListener('input', (e) => updateFrame(timestamps[e.target.value]));
    document.getElementById('mode-selector').addEventListener('change', () => updateFrame(timestamps[document.getElementById('timeline').value]));

    document.getElementById('play-pause').addEventListener('click', () => {
        const btn = document.getElementById('play-pause');
        if (playInterval) { clearInterval(playInterval); playInterval = null; btn.innerText = 'Play'; }
        else {
            btn.innerText = 'Pause';
            playInterval = setInterval(() => {
                const tl = document.getElementById('timeline');
                const next = (parseInt(tl.value) + 1) % timestamps.length;
                tl.value = next;
                updateFrame(timestamps[next]);
            }, 300);
        }
    });

    document.getElementById('update-data').addEventListener('click', async () => {
        const start = document.getElementById('start-date').value;
        const end   = document.getElementById('end-date').value;
        const btn   = document.getElementById('update-data');
        btn.disabled = true; btn.innerText = '取得中...';
        try {
            const base = `${location.protocol}//${location.hostname}:${location.port}`;
            const res  = await fetch(`${base}/api/update-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start, end })
            });
            if (res.ok) {
                await loadData();
                // データ更新に成功したら設定パネルを隠す
                document.getElementById('settings-body').classList.add('settings-hidden');
                document.getElementById('toggle-settings').innerText = '▼';
                
                // データ更新後は期間範囲の表示に変更
                const formatDateOnly = (val) => val ? val.replace(/-/g, '/').replace(/\/0/g, '/') : '';
                const dateLabel = (start === end) 
                    ? `${formatDateOnly(start)}` 
                    : `${formatDateOnly(start)} ～ ${formatDateOnly(end)}`;
                document.getElementById('current-date').innerText = `対象データ期間: ${dateLabel}`;
            }
        } finally { btn.innerText = 'データ更新'; btn.disabled = false; }
    });

    map.on('zoomend', () => { updateZoomStyles(); if (currentTimestamp) updateFrame(currentTimestamp); });
    updateZoomStyles();

    document.getElementById('export-csv').addEventListener('click', exportCSV);
    document.getElementById('toggle-panel').addEventListener('click', () => {
        const body = document.getElementById('panel-body');
        const btn  = document.getElementById('toggle-panel');
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        btn.textContent = hidden ? '▲ 閉じる' : '▼ 開く';
    });

    // 右上設定パネルのトグル処理
    document.getElementById('toggle-settings').addEventListener('click', () => {
        const body = document.getElementById('settings-body');
        const btn = document.getElementById('toggle-settings');
        const isHidden = body.classList.contains('settings-hidden');
        if (isHidden) {
            body.classList.remove('settings-hidden');
            btn.innerText = '⚙️';
            btn.style.fontSize = '16px';
        } else {
            body.classList.add('settings-hidden');
            btn.innerText = '▼';
            btn.style.fontSize = '12px';
        }
    });
}

function updateZoomStyles() {
    const zoom = map.getZoom();
    const nameSize = Math.max(6, 9 + (zoom - 10) * 1.5);
    const valueSize = Math.max(8, 11 + (zoom - 10) * 2);
    document.documentElement.style.setProperty('--name-size', `${nameSize}px`);
    document.documentElement.style.setProperty('--value-size', `${valueSize}px`);
}

async function loadData() {
    const res = await fetch('./rainfall_data.json?t=' + Date.now());
    rainfallData = await res.json();
    timestamps = Object.keys(rainfallData.timeSeries).sort();
    const tl = document.getElementById('timeline');
    tl.max = timestamps.length - 1;
    tl.value = timestamps.length - 1;
    updateFrame(timestamps[timestamps.length - 1]);
}

function updateFrame(timestamp) {
    if (!timestamp) return;
    currentTimestamp = timestamp;

    const mode = document.getElementById('mode-selector').value;
    const alertEl = document.getElementById('data-alert');

    // データ不足の判定と通知
    let alertMsg = '';
    if (mode === 'max24' && timestamps.length < 144) {
        const totalMin = timestamps.length * 10;
        alertMsg = `24時間に満たないデータ（計${Math.floor(totalMin/60)}時間${totalMin%60}分）で最大値を算出しています。`;
    } else if (mode === 'max60' && timestamps.length < 6) {
        alertMsg = `60分に満たないデータ（計${timestamps.length * 10}分）で最大値を算出しています。`;
    }
    if (alertMsg) {
        document.getElementById('alert-message').innerText = alertMsg;
        alertEl.style.display = 'block';
    } else {
        alertEl.style.display = 'none';
    }

    const parts = timestamp.split(' ');
    const displayDate = `${parseInt(parts[0].substring(4, 6))}/${parseInt(parts[0].substring(6, 8))}`;
    document.getElementById('time-display').innerText = `${displayDate} ${parts[1]}`;

    document.querySelector('.bottom-center').style.display = (mode === 'current') ? 'block' : 'none';

    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const zoom = map.getZoom();
    const stations = [];

    rainfallData.mapping.forEach(station => {
        let value = 0;         // 等雨量線の計算用（補間あり）
        let displayValue = 0;  // マーカー表示用（補間なし）
        let isMissing = false; // 描画不可フラグ
        let isDisplayMissing = false; // 表示不可フラグ

        if (mode === 'current') {
            const raw = rainfallData.timeSeries[timestamp]?.[station.name];
            if (raw === null || raw === undefined) {
                isMissing = true;
                isDisplayMissing = true;
            } else {
                value = raw;
                displayValue = raw;
            }
        } else {
            const summary = rainfallData.summary[station.row];
            const rawInterp = summary?.[mode];
            const rawDisplay = summary?.[mode + 'Raw'];
            
            if (rawInterp === null || rawInterp === undefined) isMissing = true;
            else value = rawInterp;

            if (rawDisplay === null || rawDisplay === undefined) isDisplayMissing = true;
            else displayValue = rawDisplay;
        }

        const color = isDisplayMissing ? '#888' : getRainfallColor(displayValue);
        const displayVal = isDisplayMissing ? '---' : displayValue.toFixed(mode==='max24'?1:0);

        const icon = L.divIcon({
            className: 'station-label',
            html: `<div class="station-bubble">${zoom>=10?`<div class="station-name">${station.name}</div>`:''}<div class="value-display" style="color: ${color}">${displayVal}</div></div>`
        });
        const marker = L.marker([station.lat, station.lon], { icon }).addTo(map);

        // 最大雨量モードなら記録日時をツールチップに表示（補間データのピーク時を使用）
        if (mode === 'max60' || mode === 'max24') {
            const sum = rainfallData.summary[station.row];
            const peakTime = mode === 'max60' ? (sum?.max60RawTime || sum?.max60Time) : (sum?.max24RawTime || sum?.max24Time);
            if (peakTime) {
                const parts = peakTime.split(' ');
                const formattedTime = `${parseInt(parts[0].substring(4, 6))}/${parseInt(parts[0].substring(6, 8))} ${parts[1]}`;
                marker.bindTooltip(`記録日時: ${formattedTime}`, { direction: 'top', sticky: true });
            }
        }

        markers.push(marker);
        
        if (!isMissing) {
            stations.push({
                lat: station.lat,
                lon: station.lon,
                value: value
            });
        }
    });

    renderIsolines(stations, mode);
    updateAdoptionPanel(mode);
}

function getRainfallColor(v) {
    if (v >= 50) return '#ff0033';
    if (v >= 30) return '#ff9900';
    if (v >= 20) return '#ffff00';
    if (v >= 10) return '#00ddcc';
    if (v >= 1)  return '#3399ff';
    return '#ffffff';
}

let isolineLayer;
let fillOverlay = null;

function renderIsolines(stations, mode) {
    if (isolineLayer) { map.removeLayer(isolineLayer); isolineLayer = null; }
    if (fillOverlay)  { map.removeLayer(fillOverlay);  fillOverlay  = null; }

    const grid = buildSmoothGrid(stations);

    // --- フェーズ2: 採択基準超過域の塗りつぶし (Canvas オーバーレイ) ---
    const criteria = ADOPTION_CRITERIA[mode];
    if (criteria) {
        const canvas = document.createElement('canvas');
        canvas.width  = GRID.cols;
        canvas.height = GRID.rows;
        const ctx = canvas.getContext('2d');
        for (let r = 0; r < GRID.rows; r++) {
            for (let c = 0; c < GRID.cols; c++) {
                const val = grid[r * GRID.cols + c];
                if (val >= criteria) {
                    const alpha = Math.min(0.6, 0.25 + (val - criteria) / 250);
                    ctx.fillStyle = `rgba(255, 69, 0, ${alpha})`;
                    ctx.fillRect(c, r, 1, 1);
                }
            }
        }
        const bounds = [[GRID.minLat, GRID.minLon], [GRID.maxLat, GRID.maxLon]];
        fillOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 1, zIndex: 299 }).addTo(map);
    }

    // --- フェーズ1: モード別閾値 + 採択基準ラインの強調 ---
    const thresholds = THRESHOLDS_BY_MODE[mode] || [1, 5, 10, 20, 30, 50, 80, 100];
    const isohyets = getIsolines(grid, thresholds);

    const features = isohyets.map(iso => ({
        type: 'Feature',
        properties: { value: iso.value },
        geometry: { type: 'MultiLineString', coordinates: iso.segments }
    }));

    isolineLayer = L.geoJson({ type: 'FeatureCollection', features }, {
        style: feat => {
            const v = feat.properties.value;
            const isCriteria = criteria && v === criteria;
            return {
                color:     isCriteria ? '#ff4500' : getRainfallColor(v),
                // 気象学的重み: 採択基準線>警報域>強雨>中雨>弱雨>微雨
                weight:    isCriteria ? 4 : (v >= 50 ? 3 : v >= 20 ? 2.5 : v >= 10 ? 2 : v >= 5 ? 1.5 : 1),
                opacity:   isCriteria ? 1.0 : 0.85,
                // 気象学的破線基準: 5mm以下は不確実性が高いため破線
                dashArray: isCriteria ? null : (v <= 5 ? '4 4' : null),
                className: isCriteria ? 'criteria-isoline' : ''
            };
        }
    }).addTo(map);

    // ラベル — 各閾値で最長セグメントにのみ付与
    isohyets.forEach(iso => {
        const longestSeg = iso.segments.reduce(
            (best, seg) => seg.length > best.length ? seg : best, []
        );
        if (longestSeg.length > 8) {
            const mid = longestSeg[Math.floor(longestSeg.length / 2)];
            const isCriteria = criteria && iso.value === criteria;
            const label = isCriteria
                ? `<span style="color:#ff4500;font-size:12px;font-weight:900">▶ ${iso.value}mm 採択基準</span>`
                : `<span style="color:${getRainfallColor(iso.value)}">${iso.value}mm</span>`;
            const lbl = L.marker([mid[1], mid[0]], {
                icon: L.divIcon({ className: 'isoline-value-label', html: label }),
                interactive: false
            }).addTo(map);
            markers.push(lbl);
        }
    });
}

// --- フェーズ3: 採択基準超過局パネル ---
function formatPeakTime(ts) {
    if (!ts) return '---';
    const p = ts.split(' ');
    return `${parseInt(p[0].substring(4,6))}/${parseInt(p[0].substring(6,8))} ${p[1]}`;
}

function updateAdoptionPanel(mode) {
    const panel = document.getElementById('adoption-panel');
    const criteria = ADOPTION_CRITERIA[mode];
    if (!criteria) {
        panel.classList.add('adoption-panel-hidden');
        return;
    }
    panel.classList.remove('adoption-panel-hidden');

    const modeLabel = mode === 'max24' ? '24時間降水量' : '1時間降水量';
    document.getElementById('adoption-criteria-label').textContent =
        `採択基準: ${modeLabel} ≥ ${criteria}mm`;

    const exceeded = rainfallData.mapping
        .map(s => {
            const sum  = rainfallData.summary[s.row];
            const val  = sum?.[mode + 'Raw']     ?? null;
            const time = sum?.[mode + 'RawTime'] ?? '';
            return { name: s.name, city: s.city, val, time };
        })
        .filter(s => s.val !== null && s.val >= criteria)
        .sort((a, b) => b.val - a.val);

    const tbody = document.getElementById('adoption-tbody');
    tbody.innerHTML = exceeded.map(s => `
        <tr>
            <td class="td-name">${s.name}</td>
            <td class="td-city">${s.city}</td>
            <td class="td-val" style="color:${getRainfallColor(s.val)}">
                ${s.val.toFixed(mode === 'max24' ? 1 : 0)}
            </td>
            <td class="td-time">${formatPeakTime(s.time)}</td>
        </tr>
    `).join('');

    document.getElementById('adoption-empty').style.display = exceeded.length ? 'none' : 'block';
    document.getElementById('adoption-count').textContent   = `採択基準超過 ${exceeded.length}局`;

    window._adoptionExportData = { exceeded, mode, criteria };
}

function exportCSV() {
    const data = window._adoptionExportData;
    if (!data || !data.exceeded.length) return;
    const modeLabel = data.mode === 'max24' ? '24時間降水量(mm)' : '1時間降水量(mm)';
    const rows = [
        ['観測局名', '市区町村', modeLabel, '記録日時'],
        ...data.exceeded.map(s => [
            s.name, s.city,
            s.val.toFixed(data.mode === 'max24' ? 1 : 0),
            formatPeakTime(s.time)
        ])
    ];
    const csv  = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `採択基準超過局_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

init();
