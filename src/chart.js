// --- グラフモーダル (src/chart.js) ---

let chartInstance = null;

export function openChartModal(station, timestamps, activeData, isWaterLevel = false) {
    const modal = document.getElementById('chart-modal');
    const title = document.getElementById('chart-modal-title');
    const ctx   = document.getElementById('rainfall-chart').getContext('2d');

    const targetStation = activeData.mapping.find(s => s.name === station.name);
    if (!targetStation) return;

    const labels = [];
    const datasets = [];

    const isLight   = document.body.classList.contains('light-theme');
    const textColor = isLight ? '#333' : '#fff';
    const gridColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';

    const formatTs = (t) => {
        if (!t) return '';
        const p = t.split(' ');
        if (p.length < 2) return t;
        const label = `${parseInt(p[0].substring(4,6))}/${parseInt(p[0].substring(6,8))} ${p[1]}`;
        return label.endsWith('23:59') ? label.replace('23:59', '24:00') : label;
    };

    if (isWaterLevel) {
        // --- 水位データのグラフ作成 ---
        const waterData = [];
        const tObj = targetStation.thresholds || {};

        timestamps.forEach(ts => {
            labels.push(formatTs(ts));
            const val = activeData.timeSeries[ts]?.[station.name];
            waterData.push(val !== undefined ? val : null);
        });

        datasets.push({
            label: '水位 (m)',
            data: waterData,
            type: 'line',
            borderColor: '#00ddcc',
            backgroundColor: 'rgba(0, 221, 204, 0.2)',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            yAxisID: 'y',
            order: 1
        });

        // 閾値ラインの追加
        const addThresholdLine = (val, label, color) => {
            if (val === null || val === undefined) return;
            datasets.push({
                label: `${label} (${val}m)`,
                data: Array(timestamps.length).fill(val),
                type: 'line',
                borderColor: color,
                borderWidth: 1.5,
                borderDash: [5, 5],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                yAxisID: 'y',
                order: 2
            });
        };

        addThresholdLine(tObj.danger, '氾濫危険', '#9900cc');
        addThresholdLine(tObj.evacuation, '避難判断', '#ff0033');
        addThresholdLine(tObj.warning, '氾濫注意', '#ff9900');
        addThresholdLine(tObj.standby, '水防団待機', '#ffff00');

        const summaryIndex = isWaterLevel ? activeData.mapping.indexOf(targetStation) : targetStation.row;
        const summary = activeData.summary[summaryIndex];
        const maxLvl = summary?.maxPeriod;
        const maxTime = summary?.maxPeriodTime;
        const maxTimeFormatted = maxTime ? formatTs(maxTime) : '';
        
        title.innerText = `🌊 ${station.name} 水位変化 - 期間内最高: ${maxLvl ? maxLvl.toFixed(2) + 'm' : '---'}${maxTimeFormatted ? ` (${maxTimeFormatted} 記録)` : ''}`;

    } else {
        // --- 雨量データのグラフ作成 ---
        const exactTotal = activeData.summary[targetStation.row]?.cumulativeRaw || 0;
        const hourlyData     = [];
        let   rawCumulative  = 0;
        const cumulativeData = [];

        timestamps.forEach(ts => {
            if (!ts.endsWith(':00') && !ts.endsWith('23:59')) return;
            const hourVal = activeData.timeSeries[ts]?.[station.name] ?? 0;
            labels.push(formatTs(ts));
            hourlyData.push(hourVal);
            rawCumulative += hourVal;
            cumulativeData.push(rawCumulative);
        });

        const scale = rawCumulative > 0 ? exactTotal / rawCumulative : 1;
        const scaledCumulative = cumulativeData.map(v => +(v * scale).toFixed(1));

        datasets.push({
            label: '実降水量 (mm/h)',
            data: hourlyData,
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
            yAxisID: 'y',
            order: 2,
            type: 'bar'
        });

        datasets.push({
            label: '累積雨量 (mm)',
            data: scaledCumulative,
            type: 'line',
            borderColor: '#ff4500',
            backgroundColor: '#ff4500',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            yAxisID: 'y1',
            order: 1
        });

        title.innerText = `🌧️ ${station.name} 降水量 - 総雨量: ${exactTotal.toFixed(1)}mm`;
    }

    if (chartInstance) chartInstance.destroy();

    const yScales = {
        y: {
            type: 'linear', display: true, position: 'left',
            title: { display: true, text: isWaterLevel ? '水位 (m)' : '実降水量 (mm/h)', color: textColor },
            grid:  { color: gridColor },
            ticks: { color: textColor }
        }
    };

    if (!isWaterLevel) {
        yScales.y1 = {
            type: 'linear', display: true, position: 'right',
            title: { display: true, text: '累積雨量 (mm)', color: textColor },
            grid:  { drawOnChartArea: false },
            ticks: { color: textColor }
        };
    }

    chartInstance = new Chart(ctx, {
        type: 'bar', // ベースタイプ（データセット側で line 等を上書き可能）
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend:  { labels: { color: textColor } },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleColor: '#fff', bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid:  { color: gridColor },
                    ticks: {
                        color: textColor,
                        maxRotation: 0, minRotation: 0,
                        maxTicksLimit: isWaterLevel ? 12 : 25,
                        callback: function(val, index, ticks) {
                            const label = this.getLabelForValue(val);
                            if (!label) return '';
                            const parts = label.split(' ');
                            if (parts.length !== 2) return label;
                            const [date, time] = parts;
                            const prevLabel = index > 0 ? this.getLabelForValue(ticks[index - 1].value) : null;
                            const prevDate  = prevLabel ? prevLabel.split(' ')[0] : null;
                            return date !== prevDate ? [time, date] : [time, ''];
                        }
                    }
                },
                ...yScales
            }
        }
    });

    modal.classList.remove('modal-hidden');
}
