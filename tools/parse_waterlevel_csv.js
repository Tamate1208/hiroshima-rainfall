const fs = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '..', '340006_weather_observation_station_20260411.csv');
const OUTPUT_FILE = path.join(__dirname, '..', 'waterlevel_data.json');

function parseCSV() {
    const content = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = content.split('\n');
    
    // 4行目からがデータ（0-indexed だと 3）
    const dataLines = lines.slice(3);
    
    const mapping = [];
    
    dataLines.forEach(line => {
        if (!line.trim()) return;
        
        // カンマで分割（単純な分割。名前等にカンマが含まれる場合は考慮が必要だが、
        // 今回のデータプレビューを見る限り、住所等以外にはなさそう。緯度経度の後などは空）
        // 厳密には CSV パーサーを使うべきだが、このファイル構造に特化して処理。
        const cols = line.split(',');
        
        const type = cols[0]; // データ種別
        if (type !== '4') return; // 水位局以外はスキップ
        
        const name = cols[15].trim();
        const city = cols[18].trim();
        const riverNameRaw = cols[12].trim();
        const riverNameDisplay = cols[13].trim();
        const riverName = riverNameDisplay || riverNameRaw;
        
        const lat = parseFloat(cols[20]);
        const lon = parseFloat(cols[21]);
        
        // 閾値
        const standby = parseFloat(cols[23]) || null;
        const warning = parseFloat(cols[24]) || null;
        const evacuation = parseFloat(cols[25]) || null;
        const danger = parseFloat(cols[26]) || null;
        
        if (isNaN(lat) || isNaN(lon)) return;

        mapping.push({
            name,
            city,
            lat,
            lon,
            riverName,
            coverageKm: 5.0, // デフォルト値
            thresholds: {
                standby,
                warning,
                evacuation,
                danger
            }
        });
    });
    
    console.log(`Parsed ${mapping.length} water level stations.`);
    
    // テスト用のモック時系列データを生成
    const timeSeries = {};
    const summary = [];
    const now = new Date();
    
    // 直近5スロット分（10分刻み）
    for (let i = 4; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 10 * 60000);
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        const timeStr = `${String(d.getUTCHours() + 9).padStart(2, '0')}:${String(d.getUTCMinutes()).slice(0, 1)}0`; 
        // 簡易的なJST変換と10分丸め
        const ts = `${dateStr} ${timeStr}`;
        
        timeSeries[ts] = {};
        mapping.forEach(st => {
            // 平常時を想定したランダムな水位 (0.5m ~ 1.5m 程度)
            const base = 0.5 + Math.random();
            timeSeries[ts][st.name] = Math.round(base * 100) / 100;
        });
    }

    // サマリーの生成
    mapping.forEach(st => {
        const values = Object.values(timeSeries).map(ts => ts[st.name]);
        const max = Math.max(...values);
        let maxLevel = 'normal';
        if (st.thresholds.danger && max >= st.thresholds.danger) maxLevel = 'danger';
        else if (st.thresholds.evacuation && max >= st.thresholds.evacuation) maxLevel = 'evacuation';
        else if (st.thresholds.warning && max >= st.thresholds.warning) maxLevel = 'warning';
        else if (st.thresholds.standby && max >= st.thresholds.standby) maxLevel = 'standby';

        summary.push({
            maxPeriod: max,
            maxPeriodTime: Object.keys(timeSeries).pop(),
            maxExceededLevel: maxLevel
        });
    });

    const output = {
        mapping,
        timeSeries,
        summary
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`Saved result to ${OUTPUT_FILE}`);
}

parseCSV();
