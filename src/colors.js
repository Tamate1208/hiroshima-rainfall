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

export function getSmoothRainfallColor(v) {
    const points = [
        { v: 0,   r: 51,  g: 153, b: 255, a: 0.0 },
        { v: 1,   r: 51,  g: 153, b: 255, a: 0.15 },
        { v: 10,  r: 0,   g: 221, b: 204, a: 0.25 },
        { v: 20,  r: 255, g: 255, b: 0,   a: 0.35 },
        { v: 30,  r: 255, g: 153, b: 0,   a: 0.45 },
        { v: 50,  r: 255, g: 0,   b: 51,  a: 0.55 },
        { v: 100, r: 255, g: 0,   b: 51,  a: 0.65 }
    ];
    
    if (v <= points[0].v) return points[0];
    if (v >= points[points.length - 1].v) return points[points.length - 1];
    
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        if (v >= p1.v && v <= p2.v) {
            const t = (v - p1.v) / (p2.v - p1.v);
            return {
                r: Math.round(p1.r + t * (p2.r - p1.r)),
                g: Math.round(p1.g + t * (p2.g - p1.g)),
                b: Math.round(p1.b + t * (p2.b - p1.b)),
                a: p1.a + t * (p2.a - p1.a)
            };
        }
    }
    return points[0];
}
