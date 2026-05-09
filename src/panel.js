// --- 採択基準超過局パネル (src/panel.js) ---
// Phase 1-D: window._* グローバル変数をモジュールスコープへ移動

import { ADOPTION_CRITERIA } from './constants.js';
import { getRainfallColor, getWaterLevelColor } from './colors.js';

// モジュールスコープの状態 (window._ 廃止)
let _selectedCities    = new Set();
let _adoptionExportData = null;

export function formatPeakTime(ts) {
    if (!ts) return '---';
    const p = ts.split(' ');
    return `${parseInt(p[0].substring(4,6))}/${parseInt(p[0].substring(6,8))} ${p[1]}`;
}

export function updateAdoptionPanel(currentDataType, mode, rainfallData, waterlevelData) {
    const isWaterLevel = currentDataType === 'waterlevel';
    const panel = document.getElementById('adoption-panel');

    if (!isWaterLevel) {
        const criteria = ADOPTION_CRITERIA[mode];
        if (!criteria) { panel.classList.add('adoption-panel-hidden'); return; }
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

        _setupFilters(exceeded, mode, criteria, false);
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

        _setupFilters(exceeded, mode, null, true);
    }
}

function _setupFilters(exceeded, mode, criteria, isWater) {
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
            _renderTable(isWater);
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + c));
        filterContainer.appendChild(label);
    });

    _adoptionExportData = { exceeded, mode, criteria, isWater };
    _renderTable(isWater);
}

function _renderTable(isWater) {
    const data = _adoptionExportData;
    if (!data) return;

    const filtered = (_selectedCities.size > 0)
        ? data.exceeded.filter(s => _selectedCities.has(s.city))
        : data.exceeded;

    const tbody = document.getElementById('adoption-tbody');
    tbody.innerHTML = filtered.map(s => {
        const color   = isWater ? getWaterLevelColor(s.levelStatus) : getRainfallColor(s.val);
        const valDisp = isWater ? s.val.toFixed(2) : s.val.toFixed(data.mode === 'max24' ? 1 : 0);
        return `
            <tr>
                <td class="td-name">${s.name}</td>
                <td class="td-city">${s.city}</td>
                <td class="td-val" style="color:${color}">${valDisp}</td>
                <td class="td-time">${formatPeakTime(s.time)}</td>
            </tr>`;
    }).join('');

    document.getElementById('adoption-empty').style.display = filtered.length ? 'none' : 'block';
    const countLabel = isWater ? '危険水位超過' : '採択基準超過';
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

    const modeLabel = data.mode === 'max24' ? '24時間降水量(mm)' : '1時間降水量(mm)';
    const rows = [
        ['観測局名', '市区町村', modeLabel, '記録日時'],
        ...filtered.map(s => [
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
