const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DIAG_FILE = path.join(__dirname, 'tmp', 'diag.json');
let diagnosticData = { rawRows: {} };

// プロジェクトルート（このファイルが置かれているディレクトリ）を基準にパスを解決
// Render 等のクラウド環境でも動作するよう絶対パスを廃止
const PROJECT_ROOT = __dirname;
const MAPPING_FILE = path.join(PROJECT_ROOT, 'mapping.json');
const OUTPUT_FILE  = path.join(PROJECT_ROOT, 'rainfall_data.json');
const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'temp_downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

async function downloadFile(dateStr) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const url = `https://www.bousai.pref.hiroshima.lg.jp/data/observation/${year}/${month}/${dateStr}-uryo.xlsx`;
    const dest = path.join(DOWNLOAD_DIR, `${dateStr}-uryo.xlsx`);

    if (fs.existsSync(dest)) {
        const day = parseInt(dateStr.substring(6, 8));
        const dayCompleteUTC = new Date(Date.UTC(year, parseInt(month) - 1, day + 1, 0, 0, 0) - 9 * 60 * 60 * 1000);
        const fileMtime = fs.statSync(dest).mtime;
        if (fileMtime > dayCompleteUTC) return dest;
    }

    console.log(`Downloading: ${url}`);
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'arraybuffer'
        });
        try { fs.unlinkSync(dest); } catch (_) {}
        fs.writeFileSync(dest, response.data);
        return dest;
    } catch (e) {
        console.error(`Failed to download ${url}: ${e.message}`);
        return null;
    }
}

async function processRange(startDateStr, endDateStr) {
    const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    const timeSeries = {};
    const stationMaxes = {};
    const allValues = {};     // row -> 全期間の10分値
    const allTimestamps = []; // 全期間のタイムスタンプ

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    const filePaths = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        const filePath = await downloadFile(dateStr);
        if (filePath) filePaths.push(filePath);
    }

    if (filePaths.length === 0) {
        console.error("No valid data files found.");
        return;
    }

    filePaths.forEach(filePath => {
        const fileName = path.basename(filePath);
        const dateStr = fileName.split('-')[0];
        console.log(`Processing: ${fileName}`);
        
        const workbook = XLSX.readFile(filePath);
        const sheetNames = ['雨量定時表1', '雨量定時表2', '雨量定時表3', '雨量定時表4'];
        
        // 1日を 144 個の null スロットで初期化 (デシンク防止)
        const dayData = {};
        mapping.forEach(s => dayData[s.row] = new Array(144).fill(null));

        sheetNames.forEach((sheetName, sidx) => {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) return;
            
            for (let r = 4; r <= 450; r++) {
                if (dayData[r] === undefined) continue;
                for (let c = 2; c <= 37; c++) {
                    const cellAddress = XLSX.utils.encode_cell({r: r-1, c: c});
                    const cell = sheet[cellAddress];
                    const val = cell && !isNaN(parseFloat(cell.v)) ? parseFloat(cell.v) : null;
                    
                    // シート番号(0-3)と列(2-37)から配列上の絶対位置(0-143)を計算
                    const slotIndex = (sidx * 36) + (c - 2);
                    if (slotIndex < 144) dayData[r][slotIndex] = val;
                }
            }
        });

        const dayTimestamps = [];
        for (let i = 0; i < 144; i++) {
            const h = Math.floor((i + 1) * 10 / 60);
            const m = ((i + 1) * 10) % 60;
            const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            const ts = (timeStr === '24:00') ? `${dateStr} 23:59` : `${dateStr} ${timeStr}`;
            dayTimestamps.push(ts);
        }
        allTimestamps.push(...dayTimestamps);

        mapping.forEach(station => {
            const row = station.row;
            if (!allValues[row]) allValues[row] = [];
            allValues[row].push(...(dayData[row]));
        });
    });

    mapping.forEach(station => {
        const row = station.row;
        const values = allValues[row] || [];
        stationMaxes[row] = { 
            max60: null, max60Raw: null, max24: null, max24Raw: null, 
            max60Time: '', max60RawTime: '', max24Time: '', max24RawTime: '' 
        };

        for (let i = 0; i < values.length; i++) {
            const ts = allTimestamps[i] || '';

            // --- 60分ローリング (JMA基準: 6/6) ---
            const win60Full = values.slice(Math.max(0, i - 5), i + 1);
            const win60Valid = win60Full.filter(v => v !== null);
            
            // Raw (単なる合算)
            if (win60Valid.length > 0) {
                const sum60Raw = win60Valid.reduce((a, b) => a + b, 0);
                if (stationMaxes[row].max60Raw === null || sum60Raw > stationMaxes[row].max60Raw) {
                    stationMaxes[row].max60Raw = sum60Raw;
                    stationMaxes[row].max60RawTime = ts;
                }
            }
            
            // JMA (欠測なしのみ)
            if (win60Full.length === 6 && win60Valid.length === 6) {
                const sum60 = win60Valid.reduce((a, b) => a + b, 0);
                if (!timeSeries[ts]) timeSeries[ts] = {};
                timeSeries[ts][station.name] = sum60;

                if (stationMaxes[row].max60 === null || sum60 > stationMaxes[row].max60) {
                    stationMaxes[row].max60 = sum60;
                    stationMaxes[row].max60Time = ts;
                }
            } else {
                if (!timeSeries[ts]) timeSeries[ts] = {};
                timeSeries[ts][station.name] = null;
            }

            // --- 24時間ローリング (JMA基準: 80%以上) ---
            const win24Full = values.slice(Math.max(0, i - 143), i + 1);
            const win24Valid = win24Full.filter(v => v !== null);
            
            if (win24Valid.length > 0) {
                const rawSum = win24Valid.reduce((a, b) => a + b, 0);
                // Raw値の記録
                if (stationMaxes[row].max24Raw === null || rawSum > stationMaxes[row].max24Raw) {
                    stationMaxes[row].max24Raw = rawSum;
                    stationMaxes[row].max24RawTime = ts;
                }
                
                // JMA補間値（80%以上で推定）の記録
                const estimatedSum = Math.round((rawSum * (144 / win24Valid.length)) * 10) / 10;
                if (stationMaxes[row].max24 === null || estimatedSum > stationMaxes[row].max24) {
                    stationMaxes[row].max24 = estimatedSum;
                    stationMaxes[row].max24Time = ts;
                }
            }
        }
    });

    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const nowDateStr = nowJST.toISOString().replace('T', ' ').substring(0, 16).replace(/-/g, '');
    Object.keys(timeSeries).forEach(ts => {
        if (ts > nowDateStr) delete timeSeries[ts];
    });

    const output = {
        mapping: mapping,
        timeSeries: timeSeries,
        summary: stationMaxes,
        range: { start: startDateStr, end: endDateStr }
    };

    // --- 観測局の故障（不自然な0mm）チェック ---
    console.log("Checking for malfunctioning stations (constant 0mm during rain)...");
    const dist = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const faultyStations = [];
    mapping.forEach(target => {
        const row = target.row;
        const targetSummary = stationMaxes[row];
        // 期間中最大が0（＝全期間0）かつ、データは存在している場合
        if (targetSummary.max24Raw === 0) {
            let neighborCount = 0;
            let wetNeighborCount = 0;
            let maxNeighborRain = 0;

            mapping.forEach(other => {
                if (target.row === other.row) return;
                const d = dist(target.lat, target.lon, other.lat, other.lon);
                if (d < 15) { // 15km以内
                    neighborCount++;
                    const otherMax = stationMaxes[other.row].max24 || 0;
                    if (otherMax >= 5) { // 5mm以上の雨を観測
                        wetNeighborCount++;
                        maxNeighborRain = Math.max(maxNeighborRain, otherMax);
                    }
                }
            });

            // 判定条件: 周囲3局以上が雨（5mm以上）なのに自身が0
            if (wetNeighborCount >= 3) {
                console.log(`[Malfunction Detected] ${target.city} ${target.name} (Total 0mm while neighbors saw up to ${maxNeighborRain}mm)`);
                faultyStations.push(target.name);
                
                // データの無効化
                stationMaxes[row].max60 = null;
                stationMaxes[row].max60Raw = null;
                stationMaxes[row].max24 = null;
                stationMaxes[row].max24Raw = null;
                stationMaxes[row].max60Time = '';
                stationMaxes[row].max60RawTime = '';
                stationMaxes[row].max24Time = '';
                stationMaxes[row].max24RawTime = '';
                
                Object.keys(timeSeries).forEach(ts => {
                    if (timeSeries[ts][target.name] !== undefined) {
                        timeSeries[ts][target.name] = null;
                    }
                });
            }
        }
    });
    if (faultyStations.length > 0) {
        console.log(`Summary: ${faultyStations.length} stations marked as faulty.`);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
    console.log(`Success! Data written to ${OUTPUT_FILE}`);
}

const start = process.argv[2] || '2026-03-31';
const end = process.argv[3] || start;
processRange(start, end).catch(console.error);
