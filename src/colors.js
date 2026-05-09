// --- 色定義 (src/colors.js) ---

export function getRainfallColor(v) {
    if (v >= 50) return '#ff0033';
    if (v >= 30) return '#ff9900';
    if (v >= 20) return '#ffff00';
    if (v >= 10) return '#00ddcc';
    if (v >= 1)  return '#3399ff';
    return '#ffffff';
}

export function getWaterLevelStatus(val, t) {
    if (!t || val === null || val === undefined) return 'normal';
    
    if (t.danger === null && t.evacuation === null && t.warning === null && t.standby === null) {
        return 'none';
    }

    if (t.danger !== null && val >= t.danger)     return 'danger';
    if (t.evacuation !== null && val >= t.evacuation) return 'evacuation';
    if (t.warning !== null && val >= t.warning)    return 'warning';
    if (t.standby !== null && val >= t.standby)    return 'standby';
    return 'normal';
}

export function getWaterLevelColor(status) {
    const colors = {
        normal:     '#00ddcc',
        standby:    '#ffff00',
        warning:    '#ff9900',
        evacuation: '#ff0033',
        danger:     '#9900cc',
        none:       '#ffffff'
    };
    return colors[status] ?? colors.none;
}
