// --- 採択基準超過局パネル (src/panel.js) ---
// Phase 1-D: window._* グローバル変数をモジュールスコープへ移動

import { ADOPTION_CRITERIA } from './constants.js';
import { getRainfallColor, getWaterLevelColor, getRprimeColor } from './colors.js';

// モジュールスコープの状態 (window._ 廃止)
let _selectedCities = new Set();
let _adoptionExportData = null;

export function formatPeakTime(ts) {
    if (!ts) return '---';
    const p = ts.split(' ');
    return `${parseInt(p[0].substring(4, 6))}/${parseInt(p[0].substring(6, 8))} ${p[1]}`;
}

export function updateAdoptionPanel(currentDataType, mode, rainfallData, waterlevelData) {
    const isWaterLevel = currentDataType === 'waterlevel';
    const panel = document.getElementById('adoption-panel');

    if (!isWaterLevel) {
        // --- 雨量模式 ---
        if (mode === 'rprimeMax') {
            // R' 期間最大値モード
            if (!rainfallData) { panel.classList.add('adoption-panel-hidden'); return; }
            panel.classList.remove('adoption-panel-hidden');
            document.getElementById('panel-icon').textContent = '🔶';
            document.getElementById('adoption-criteria-label').textContent =
                '危険度: R\' ≥ 125mm（注意以上の局）';

            const exceeded = rainfallData.mapping
                .map(s => {
                    const sum = rainfallData.summary[s.row];
                    return {
                        name: s.name,
                        city: s.city,
                        val:  sum?.maxRprime ?? null,
                        time: sum?.maxRprimeTime ?? '',
                        levelStatus: sum?.maxRprimeLevel || 'normal'
                    };
                })
                .filter(s => s.levelStatus !== 'normal' && s.val !== null)
                .sort((a, b) => b.val - a.val);

            _setupFilters(exceeded, mode, null, false, true);
            return;
        }

        const criteria = ADOPTION_CRITERIA[mode];
        if (!criteria || mode === 'current') { panel.classList.add('adoption-panel-hidden'); return; }
        panel.classList.remove('adoption-panel-hidden');

        const modeLabel = mode === 'max24' ? '24時間降水量' : '1時間降水量';
        document.getElementById('adoption-criteria-label').textContent =
            `採択基準: ${modeLabel} ≥ ${criteria}mm`;

        const exceeded = rainfallData.mapping
            .map(s => {
                const sum = rainfallData.summary[s.row];
                const val = sum?.[mode + 'Raw'] ?? null;
                const time = sum?.[mode + 'RawTime'] ?? '';
                return { name: s.name, city: s.city, val, time };
            })
            .filter(s => s.val !== null && s.val >= criteria)
            .sort((a, b) => b.val - a.val);

        _setupFilters(exceeded, mode, criteria, false, false);
    } else {
        if (!waterlevelData || mode !== 'maxPeriod') {
            panel.classList.add('adoption-panel-hidden'); return;
        }
        panel.classList.remove('adoption-panel-hidden');
        document.getElementById('adoption-criteria-label').textContent =
            '基準: はん濫注意水位(または待機単位)以上';

        const exceeded = waterlevelData.mapping
            .map((s, idx) => {
                const sum = waterlevelData.summary[idx];
                const val = sum?.maxPeriod ?? null;
                const time = sum?.maxPeriodTime ?? '';
                const levelStatus = sum?.maxExceededLevel || 'normal';
                return { name: s.name, city: s.city, val, time, levelStatus };
            })
            .filter(s => s.levelStatus !== 'normal')
            .sort((a, b) => b.val - a.val);

        _setupFilters(exceeded, mode, null, true, false);
    }
}

function _setupFilters(exceeded, mode, criteria, isWater, isRprime = false) {
    const filterContainer = document.getElementById('adoption-city-filter-container');
    const cities = [...new Set(exceeded.map(s => s.city))].sort();

    // 存在しない市を選択状態から除去
    _selectedCities.forEach(c => { if (!cities.includes(c)) _selectedCities.delete(c); });

    filterContainer.innerHTML = '';
    filterContainer.className = 'checkbox-list-container';

    cities.forEach(c => {
        const label = document.createElement('label');
        label.className = 'city-checkbox-label';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = c;
        cb.checked = _selectedCities.has(c);
        cb.addEventListener('change', (e) => {
            if (e.target.checked) _selectedCities.add(c);
            else _selectedCities.delete(c);
            _renderTable(isWater, isRprime);
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + c));
        filterContainer.appendChild(label);
    });

    _adoptionExportData = { exceeded, mode, criteria, isWater, isRprime };
    _renderTable(isWater, isRprime);
}

function _renderTable(isWater, isRprime = false) {
    const data = _adoptionExportData;
    if (!data) return;
    // isRprime は _adoptionExportData からも参照可能
    const _isRprime = data.isRprime || isRprime;

    const filtered = (_selectedCities.size > 0)
        ? data.exceeded.filter(s => _selectedCities.has(s.city))
        : data.exceeded;

    const tbody = document.getElementById('adoption-tbody');
    tbody.innerHTML = filtered.map(s => {
        let color, valDisp;
        if (_isRprime) {
            color   = getRprimeColor(s.levelStatus);
            valDisp = s.val !== null ? s.val.toFixed(1) : '---';
        } else if (isWater) {
            color   = getWaterLevelColor(s.levelStatus);
            valDisp = s.val !== null ? s.val.toFixed(2) : '---';
        } else {
            color   = getRainfallColor(s.val);
            valDisp = s.val !== null ? s.val.toFixed(data.mode === 'max24' ? 1 : 0) : '---';
        }
        return `
            <tr>
                <td class="td-name">${s.name}</td>
                <td class="td-city">${s.city}</td>
                <td class="td-val" style="color:${color}">${valDisp}</td>
                <td class="td-time">${formatPeakTime(s.time)}</td>
            </tr>`;
    }).join('');

    document.getElementById('adoption-empty').style.display = filtered.length ? 'none' : 'block';
    const countLabel = _isRprime ? 'R\'危険超過' : (isWater ? '危険水位超過' : '採択基準超過');
    const prefix = _selectedCities.size > 0 ? `選択地域: ${countLabel}` : countLabel;
    document.getElementById('adoption-count').textContent = `${prefix} ${filtered.length}局`;
}

export function exportCSV() {
    const data = _adoptionExportData;
    if (!data || !data.exceeded.length) return;

    const filtered = (_selectedCities.size > 0)
        ? data.exceeded.filter(s => _selectedCities.has(s.city))
        : data.exceeded;
    if (!filtered.length) return;

    const modeLabel = data.mode === 'rprimeMax' ? 'R\'値(mm)'
        : data.mode === 'max24' ? '24時間降水量(mm)' : '1時間降水量(mm)';
    const rows = [
        ['観測局名', '市区町村', modeLabel, '記録日時'],
        ...filtered.map(s => [
            s.name, s.city,
            s.val.toFixed(data.mode === 'max24' ? 1 : 0),
            formatPeakTime(s.time)
        ])
    ];
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `採択基準超過局_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 市町毎にグループ化された帳票形式のPDF出力
 * ブラウザ標準の印刷レンダリングエンジンを活用し、日本語文字化けゼロ＆A4帳票レイアウトでPDF出力
 */
export function exportPDF() {
    const data = _adoptionExportData;
    if (!data || !data.exceeded.length) {
        alert('出力対象の採択基準超過局データがありません。');
        return;
    }

    const filtered = (_selectedCities.size > 0)
        ? data.exceeded.filter(s => _selectedCities.has(s.city))
        : data.exceeded;
    if (!filtered.length) {
        alert('選択された地域に対象局がありません。');
        return;
    }

    const isWater = data.dataType === 'waterlevel';
    const isRprime = (data.mode === 'rprime' || data.mode === 'rprimeMax');
    const modeLabel = isRprime ? "R'土砂災害危険度 (基準超過)"
        : isWater ? "危険水位超過"
        : data.mode === 'max24' ? "24時間降水量 (採択基準 80mm)"
        : data.mode === 'max60' ? "1時間降水量 (採択基準 20mm)"
        : "リアルタイム降水量 (採択基準 20mm)";

    const valueHeader = isRprime ? "R'値 (mm)"
        : isWater ? "水位 (m)"
        : data.mode === 'max24' ? "24時間雨量 (mm)"
        : "時間雨量 (mm)";

    // 市町ごとにグルーピング
    const byCity = {};
    filtered.forEach(s => {
        const city = s.city || 'その他';
        if (!byCity[city]) byCity[city] = [];
        byCity[city].push(s);
    });

    // 市町名順にソートし、市町内の観測局は雨量降順でソート
    const sortedCities = Object.keys(byCity).sort((a, b) => a.localeCompare(b, 'ja'));
    sortedCities.forEach(city => {
        byCity[city].sort((a, b) => (b.val || 0) - (a.val || 0));
    });

    // 出力日時 (JST)
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const printedAt = nowJST.toISOString().replace('T', ' ').substring(0, 16).replace(/-/g, '/');

    // 期間ラベル
    const dateLabelEl = document.getElementById('current-date');
    const periodText = dateLabelEl ? dateLabelEl.innerText.replace('対象データ期間: ', '') : '';

    // 帳票HTML生成
    let html = `
        <div class="print-page">
            <header class="print-header">
                <div class="print-title-row">
                    <h1 class="print-main-title">広島県 採択基準超過局一覧表（市町別）</h1>
                    <span class="print-badge">公的帳票形式</span>
                </div>
                <div class="print-meta-grid">
                    <div class="print-meta-item"><span class="print-meta-label">基準種別:</span> <span class="print-meta-val">${modeLabel}</span></div>
                    <div class="print-meta-item"><span class="print-meta-label">対象期間:</span> <span class="print-meta-val">${periodText}</span></div>
                    <div class="print-meta-item"><span class="print-meta-label">出力日時:</span> <span class="print-meta-val">${printedAt}</span></div>
                    <div class="print-meta-item"><span class="print-meta-label">集計結果:</span> <span class="print-meta-val"><strong>${filtered.length}局</strong>（${sortedCities.length} 市町）</span></div>
                </div>
            </header>

            <main class="print-content">
    `;

    sortedCities.forEach(city => {
        const stations = byCity[city];
        html += `
            <section class="print-city-section">
                <div class="print-city-header">
                    <h2 class="print-city-name">■ ${city}</h2>
                    <span class="print-city-badge">超過局数: ${stations.length}局</span>
                </div>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th class="th-p-name">観測局名</th>
                            <th class="th-p-val">${valueHeader}</th>
                            <th class="th-p-status">基準判定</th>
                            <th class="th-p-time">ピーク記録日時</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        stations.forEach(s => {
            let valDisp;
            if (isRprime) valDisp = s.val !== null ? s.val.toFixed(1) : '---';
            else if (isWater) valDisp = s.val !== null ? s.val.toFixed(2) : '---';
            else valDisp = s.val !== null ? s.val.toFixed(data.mode === 'max24' ? 1 : 0) : '---';

            const statusText = isRprime ? (s.levelStatus === 'danger' ? '土石流危険' : s.levelStatus === 'caution' ? '山地崩壊注意' : 'がけ崩れ警戒')
                : isWater ? (s.levelStatus === 'danger' ? '氾濫危険' : s.levelStatus === 'evacuation' ? '避難判断' : s.levelStatus === 'warning' ? '氾濫警戒' : '水防団待機')
                : '基準超過';

            html += `
                <tr>
                    <td class="td-p-name"><strong>${s.name}</strong></td>
                    <td class="td-p-val"><strong>${valDisp}</strong></td>
                    <td class="td-p-status"><span class="print-status-tag">${statusText}</span></td>
                    <td class="td-p-time">${formatPeakTime(s.time)}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </section>
        `;
    });

    html += `
            </main>
            <footer class="print-footer">
                <span>GioV 雨量計 (GioV Rainfall Monitor)</span>
                <span>※本資料は広島県防災Web公表データに基づき自動集計されたものです。</span>
            </footer>
        </div>
    `;

    let printDiv = document.getElementById('print-report-container');
    if (!printDiv) {
        printDiv = document.createElement('div');
        printDiv.id = 'print-report-container';
        document.body.appendChild(printDiv);
    }
    printDiv.innerHTML = html;

    // 印刷ダイアログの起動（ユーザーは「PDFとして保存」を選択可能）
    window.print();
}
