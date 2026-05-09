// --- メインエントリーポイント (src/main.js) ---
// Phase 1-C: isolineLayer / fillOverlay をファイル先頭に宣言
// Phase 4-A: データ取得失敗をUIに表示

import { getRainfallColor, getWaterLevelColor, getWaterLevelStatus } from './colors.js';
import { renderIsolines, renderRivers } from './rendering.js';
import { updateAdoptionPanel, exportCSV } from './panel.js';
import { openChartModal } from './chart.js';

// --- グローバル状態 ---
let map, rainfallData, markers = [];
let waterlevelData = null;
let riverGeoJson   = null;
let currentDataType = 'rainfall';

// Phase 1-C: ファイル先頭で宣言（旧: L718-719 で途中宣言）
let riverLayer    = null;
let isolineLayer  = null;
let fillOverlay   = null;

let baseLayer;
let currentTimestamp;
let timestamps   = [];
let playInterval = null;
let showIsolines = true; // 等雨量線の表示フラグ

// --- 初期化 ---
async function init() {
    map = L.map('map', { zoomControl: false, attributionControl: false })
            .setView([34.5, 132.8], 10);

    const themes = {
        dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    };
    baseLayer = L.tileLayer(themes.dark).addTo(map);

    document.getElementById('theme-selector').addEventListener('change', (e) => {
        const theme = e.target.value;
        baseLayer.setUrl(themes[theme]);
        document.body.classList.toggle('light-theme', theme === 'light');
    });

    document.getElementById('datatype-selector').addEventListener('change', (e) => {
        currentDataType = e.target.value;

        document.getElementById('legend-rainfall').classList.toggle('legend-hidden', currentDataType !== 'rainfall');
        document.getElementById('legend-waterlevel').classList.toggle('legend-hidden', currentDataType !== 'waterlevel');
        document.getElementById('panel-icon').textContent = currentDataType === 'waterlevel' ? '🌊' : '🔴';

        const modeSelector = document.getElementById('mode-selector');
        modeSelector.innerHTML = currentDataType === 'rainfall' ? `
            <option value="current">リアルタイム表示 (60分降水量)</option>
            <option value="max60">期間中最大60分降水量</option>
            <option value="max24">期間中最大24時間降水量</option>
            <option value="cumulative">期間中累加雨量 (総雨量)</option>
        ` : `
            <option value="current">リアルタイム水位</option>
            <option value="maxPeriod">期間内最高水位</option>
        `;

        const activeData = currentDataType === 'rainfall' ? rainfallData : waterlevelData;
        if (activeData?.timeSeries) {
            timestamps = Object.keys(activeData.timeSeries).sort();
            const tl = document.getElementById('timeline');
            tl.max   = timestamps.length - 1;
            tl.value = Math.min(tl.value, timestamps.length - 1);
            if (timestamps[tl.value]) updateFrame(timestamps[tl.value]);
        } else {
            markers.forEach(m => map.removeLayer(m));
            if (isolineLayer) { map.removeLayer(isolineLayer); isolineLayer = null; }
            if (fillOverlay)  { map.removeLayer(fillOverlay);  fillOverlay  = null; }
            if (riverLayer)   { map.removeLayer(riverLayer);   riverLayer   = null; }
        }
    });

    // 日付初期値を今日に設定
    const now      = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const fmt = (d) => d.getFullYear() + '-' +
                       String(d.getMonth() + 1).padStart(2, '0') + '-' +
                       String(d.getDate()).padStart(2, '0');

    document.getElementById('start-date').value = fmt(now);
    document.getElementById('end-date').value   = fmt(tomorrow);

    document.getElementById('current-date').innerText =
        `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ` +
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    document.getElementById('start-date').addEventListener('change', (e) => {
        const d = new Date(e.target.value);
        d.setDate(d.getDate() + 1);
        document.getElementById('end-date').value = fmt(d);
    });

    await loadData();

    document.getElementById('timeline').addEventListener('input', (e) =>
        updateFrame(timestamps[e.target.value])
    );
    document.getElementById('mode-selector').addEventListener('change', () =>
        updateFrame(timestamps[document.getElementById('timeline').value])
    );

    document.getElementById('play-pause').addEventListener('click', () => {
        const btn = document.getElementById('play-pause');
        if (playInterval) {
            clearInterval(playInterval); playInterval = null; btn.innerText = 'Play';
        } else {
            btn.innerText = 'Pause';
            playInterval = setInterval(() => {
                const tl   = document.getElementById('timeline');
                const next = (parseInt(tl.value) + 1) % timestamps.length;
                tl.value = next;
                updateFrame(timestamps[next]);
            }, 300);
        }
    });

    document.getElementById('update-data').addEventListener('click', async () => {
        const start = document.getElementById('start-date').value;
        const end   = document.getElementById('end-date').value;

        // 重複ダウンロードチェック
        // rainfall_data.json の range フィールドと比較して既取得済みかを確認
        if (rainfallData?.range) {
            const reqStart = start.replace(/-/g, '');  // '2026-05-09' → '20260509'
            const reqEnd   = end.replace(/-/g, '');
            const { start: exStart, end: exEnd } = rainfallData.range;
            const fmtR = (s) => `${parseInt(s.substring(4,6))}/${parseInt(s.substring(6,8))}`;

            if (reqStart >= exStart && reqEnd <= exEnd) {
                // 要求期間が既取得範囲に完全に含まれる
                const msg = `${fmtR(reqStart)}〜${fmtR(reqEnd)} のデータは既に取得済みです。\n（取得済み期間: ${fmtR(exStart)}〜${fmtR(exEnd)}）\n\n再取得しますか？`;
                if (!confirm(msg)) return;
            }
        }

        const btn   = document.getElementById('update-data');
        btn.disabled = true; btn.innerText = '取得中...';

        try {
            const base = `${location.protocol}//${location.hostname}:${location.port}`;
            const res  = await fetch(`${base}/api/update-data`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ start, end })
            });
            if (res.ok) {
                await loadData();
                document.getElementById('settings-body').classList.add('settings-hidden');
                document.getElementById('toggle-settings').innerText = '▼';
                const fmtDate = (v) => v ? v.replace(/-/g, '/').replace(/\/0/g, '/') : '';
                const dateLabel = start === end ? fmtDate(start) : `${fmtDate(start)} ～ ${fmtDate(end)}`;
                document.getElementById('current-date').innerText = `対象データ期間: ${dateLabel}`;
            } else {
                // Phase 4-A: APIエラーをUIに表示
                const body = await res.json().catch(() => ({}));
                showAlert(body.error || 'データ更新に失敗しました');
            }
        } catch(e) {
            showAlert('サーバーへの接続に失敗しました');
        } finally {
            btn.innerText = 'データ更新'; btn.disabled = false;
        }
    });

    map.on('zoomend', () => { updateZoomStyles(); if (currentTimestamp) updateFrame(currentTimestamp); });
    updateZoomStyles();

    // 等雨量線 表示/非表示トグル
    document.getElementById('toggle-isolines').addEventListener('change', (e) => {
        showIsolines = e.target.checked;
        if (!showIsolines) {
            // 即時非表示: 再描画なしで現在レイヤーを削除
            if (isolineLayer) { map.removeLayer(isolineLayer); isolineLayer = null; }
            if (fillOverlay)  { map.removeLayer(fillOverlay);  fillOverlay  = null; }
        } else {
            // 再表示: 現在タイムスタンプで再描画
            if (currentTimestamp) updateFrame(currentTimestamp);
        }
    });

    document.getElementById('export-csv').addEventListener('click', exportCSV);
    document.getElementById('toggle-panel').addEventListener('click', () => {
        const body   = document.getElementById('panel-body');
        const btn    = document.getElementById('toggle-panel');
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        btn.textContent    = hidden ? '▲ 閉じる' : '▼ 開く';
    });

    document.getElementById('toggle-settings').addEventListener('click', () => {
        const body     = document.getElementById('settings-body');
        const btn      = document.getElementById('toggle-settings');
        const isHidden = body.classList.contains('settings-hidden');
        if (isHidden) {
            body.classList.remove('settings-hidden');
            btn.innerText   = '⚙️';
            btn.style.fontSize = '16px';
        } else {
            body.classList.add('settings-hidden');
            btn.innerText   = '▼';
            btn.style.fontSize = '12px';
        }
    });

    const closeModal = () => document.getElementById('chart-modal').classList.add('modal-hidden');
    document.getElementById('close-chart-modal').addEventListener('click', closeModal);
    document.getElementById('chart-modal').addEventListener('click', (e) => {
        if (e.target.id === 'chart-modal') closeModal();
    });
}

// Phase 4-A: アラート表示ヘルパー
function showAlert(message) {
    document.getElementById('alert-message').innerText = message;
    document.getElementById('data-alert').style.display = 'block';
    setTimeout(() => {
        document.getElementById('data-alert').style.display = 'none';
    }, 5000);
}

function updateZoomStyles() {
    const zoom     = map.getZoom();
    const nameSize  = Math.max(6,  9  + (zoom - 10) * 1.5);
    const valueSize = Math.max(8, 11  + (zoom - 10) * 2);
    document.documentElement.style.setProperty('--name-size',  `${nameSize}px`);
    document.documentElement.style.setProperty('--value-size', `${valueSize}px`);
}

async function loadData() {
    try {
        const res  = await fetch('./rainfall_data.json?t=' + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rainfallData = await res.json();
    } catch(e) {
        // Phase 4-A: 雨量データ取得失敗をUIに表示
        console.error('Rainfall data load failed:', e);
        showAlert('雨量データの読み込みに失敗しました');
        return;
    }

    try {
        const resWater = await fetch('./waterlevel_data.json?t=' + Date.now());
        waterlevelData = await resWater.json();
    } catch(e) { console.warn('Water level data unavailable.'); }

    try {
        const resRiver = await fetch('./rivers.geojson?t=' + Date.now());
        riverGeoJson = await resRiver.json();
    } catch(e) { console.warn('Rivers GeoJSON unavailable.'); }

    if (currentDataType === 'rainfall' && rainfallData) {
        timestamps = Object.keys(rainfallData.timeSeries).sort();
        const tl   = document.getElementById('timeline');
        tl.max     = timestamps.length - 1;
        tl.value   = timestamps.length - 1;
        updateFrame(timestamps[timestamps.length - 1]);
    }
}

function updateFrame(timestamp) {
    if (!timestamp) return;
    currentTimestamp = timestamp;

    const mode         = document.getElementById('mode-selector').value;
    const isWaterLevel = currentDataType === 'waterlevel';
    const activeData   = isWaterLevel ? waterlevelData : rainfallData;
    if (!activeData) return;

    // データ不足アラート
    if (!isWaterLevel) {
        if (mode === 'max24' && timestamps.length < 144) {
            const totalMin = timestamps.length * 10;
            showDataAlert(`24時間に満たないデータ（計${Math.floor(totalMin/60)}時間${totalMin%60}分）で最大値を算出しています。`);
        } else if (mode === 'max60' && timestamps.length < 6) {
            showDataAlert(`60分に満たないデータ（計${timestamps.length * 10}分）で最大値を算出しています。`);
        } else {
            hideDataAlert();
        }
    } else {
        hideDataAlert();
    }

    // 等雨量線トグルの表示制御
    const isolineToggle = document.getElementById('isoline-toggle-container');
    if (isolineToggle) {
        isolineToggle.style.display = (isWaterLevel && mode === 'maxPeriod') ? 'none' : 'flex';
    }

    const parts       = timestamp.split(' ');
    const displayDate = `${parseInt(parts[0].substring(4,6))}/${parseInt(parts[0].substring(6,8))}`;
    document.getElementById('time-display').innerText = `${displayDate} ${parts[1]}`;
    document.querySelector('.bottom-center').style.display = (mode === 'current') ? 'block' : 'none';

    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const zoom     = map.getZoom();
    const stations = [];

    activeData.mapping.forEach((station, idx) => {
        let value = 0, displayValue = 0;
        let isMissing = false, isDisplayMissing = false;
        let levelStatus = 'normal';

        if (mode === 'current') {
            const raw = activeData.timeSeries[timestamp]?.[station.name];
            if (raw === null || raw === undefined) {
                isMissing = isDisplayMissing = true;
            } else {
                value = displayValue = raw;
                if (isWaterLevel) levelStatus = getWaterLevelStatus(raw, station.thresholds);
            }
        } else {
            const summary = isWaterLevel ? activeData.summary[idx] : activeData.summary[station.row];
            if (!summary) {
                isMissing = isDisplayMissing = true;
            } else if (isWaterLevel) {
                displayValue = summary.maxPeriod;
                if (displayValue === null || displayValue === undefined) {
                    isMissing = isDisplayMissing = true;
                } else {
                    value = displayValue;
                    levelStatus = summary.maxExceededLevel || getWaterLevelStatus(value, station.thresholds);
                }
            } else {
                const rawInterp  = summary[mode];
                const rawDisplay = summary[mode + 'Raw'];
                if (rawInterp  === null || rawInterp  === undefined) isMissing = true;
                else value = rawInterp;
                if (rawDisplay === null || rawDisplay === undefined) isDisplayMissing = true;
                else displayValue = rawDisplay;
            }
        }

        const color      = isDisplayMissing ? '#888' : (isWaterLevel ? getWaterLevelColor(levelStatus) : getRainfallColor(displayValue));
        const formatter  = (v) => isWaterLevel ? v.toFixed(2) : v.toFixed(mode === 'max24' ? 1 : 0);
        const displayVal = isDisplayMissing ? '---' : formatter(displayValue);

        const icon = L.divIcon({
            className: 'station-label',
            html: `<div class="station-bubble">${zoom >= 10 ? `<div class="station-name">${station.name}</div>` : ''}<div class="value-display" style="color:${color}">${displayVal}</div></div>`
        });
        const marker = L.marker([station.lat, station.lon], { icon }).addTo(map);

        if ((mode === 'cumulative' && !isWaterLevel) || (mode === 'maxPeriod' && isWaterLevel)) {
            marker.bindTooltip('クリックしてグラフを表示', { direction: 'top', sticky: true });
            marker.on('click', () => openChartModal(station, timestamps, activeData, isWaterLevel));
        } else if (mode !== 'current') {
            const summary = isWaterLevel ? activeData.summary[idx] : activeData.summary[station.row];
            if (summary) {
                const peakTime = isWaterLevel
                    ? summary.maxPeriodTime
                    : (mode === 'max60' ? (summary.max60RawTime || summary.max60Time) : (summary.max24RawTime || summary.max24Time));
                if (peakTime) {
                    const tsParts = peakTime.split(' ');
                    const fmtTime = tsParts.length >= 2
                        ? `${parseInt(tsParts[0].substring(4,6))}/${parseInt(tsParts[0].substring(6,8))} ${tsParts[1]}`
                        : peakTime;
                    marker.bindTooltip(`記録日時: ${fmtTime}`, { direction: 'top', sticky: true });
                }
            }
        }

        markers.push(marker);
        if (!isMissing) stations.push({ lat: station.lat, lon: station.lon, value, station, levelStatus });
    });

    if (isWaterLevel) {
        if (isolineLayer) { map.removeLayer(isolineLayer); isolineLayer = null; }
        if (fillOverlay)  { map.removeLayer(fillOverlay);  fillOverlay  = null; }
        riverLayer = renderRivers(map, riverGeoJson, stations, riverLayer);
        
        if (showIsolines && mode === 'current' && rainfallData) {
            let rainStations = [];
            rainfallData.mapping.forEach(station => {
                const raw = rainfallData.timeSeries[timestamp]?.[station.name];
                if (raw !== null && raw !== undefined) {
                    rainStations.push({ lat: station.lat, lon: station.lon, value: raw, station });
                }
            });
            ({ isolineLayer, fillOverlay } = renderIsolines(map, rainStations, 'current', markers, isolineLayer, fillOverlay));
        }
    } else {
        if (riverLayer) { map.removeLayer(riverLayer); riverLayer = null; }
        if (showIsolines) {
            ({ isolineLayer, fillOverlay } = renderIsolines(map, stations, mode, markers, isolineLayer, fillOverlay));
        } else {
            if (isolineLayer) { map.removeLayer(isolineLayer); isolineLayer = null; }
            if (fillOverlay)  { map.removeLayer(fillOverlay);  fillOverlay  = null; }
        }
    }

    updateAdoptionPanel(currentDataType, mode, rainfallData, waterlevelData);
}

function showDataAlert(msg) {
    document.getElementById('alert-message').innerText = msg;
    document.getElementById('data-alert').style.display = 'block';
}

function hideDataAlert() {
    document.getElementById('data-alert').style.display = 'none';
}

init();
