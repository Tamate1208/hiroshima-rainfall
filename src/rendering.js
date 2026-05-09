// --- レンダリング (src/rendering.js) ---
// WebWorker は一旦廃止し、同期処理で確実に動作させる

import * as turf from '@turf/turf';
import { GRID, ADOPTION_CRITERIA, THRESHOLDS_BY_MODE } from './constants.js';
import { buildSmoothGrid } from './interpolation.js';
import { getIsolines } from './contour.js';
import { getRainfallColor, getWaterLevelColor } from './colors.js';

/**
 * 等雨量線をレンダリング (同期)
 * @returns {{ isolineLayer: object|null, fillOverlay: object|null }}
 */
export function renderIsolines(map, stations, mode, markersList, prevIsolineLayer, prevFillOverlay) {
    console.debug(`[renderIsolines] stations=${stations.length}, mode=${mode}`);
    if (prevIsolineLayer) { map.removeLayer(prevIsolineLayer); }
    if (prevFillOverlay)  { map.removeLayer(prevFillOverlay);  }

    if (stations.length < 3) {
        console.debug('[renderIsolines] 観測局が3局未満のためスキップ');
        return { isolineLayer: null, fillOverlay: null };
    }

    const grid = buildSmoothGrid(stations);

    // --- 採択基準超過域の塗りつぶし (Canvas オーバーレイ) ---
    const criteria = ADOPTION_CRITERIA[mode];
    let fillOverlay = null;
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

    // --- 等雨量線レイヤー ---
    const thresholds = THRESHOLDS_BY_MODE[mode] ?? [1, 5, 10, 20, 30, 50];
    const isohyets = getIsolines(grid, thresholds);

    const features = isohyets.map(iso => ({
        type: 'Feature',
        properties: { value: iso.value },
        geometry: { type: 'MultiLineString', coordinates: iso.segments }
    }));

    const isolineLayer = L.geoJson({ type: 'FeatureCollection', features }, {
        style: feat => {
            const v = feat.properties.value;
            const isCriteria = criteria && v === criteria;
            return {
                color:     isCriteria ? '#ff4500' : getRainfallColor(v),
                weight:    isCriteria ? 4 : (v >= 50 ? 3 : v >= 20 ? 2.5 : v >= 10 ? 2 : v >= 5 ? 1.5 : 1),
                opacity:   isCriteria ? 1.0 : 0.85,
                dashArray: isCriteria ? null : (v <= 5 ? '4 4' : null),
                className: isCriteria ? 'criteria-isoline' : ''
            };
        }
    }).addTo(map);

    // --- 等雨量線ラベル (最長セグメントのみ) ---
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
            markersList.push(lbl);
        }
    });

    return { isolineLayer, fillOverlay };
}

/**
 * 河川水位レイヤーをレンダリング (同期)
 * @returns {object|null} 新しい riverLayer
 */
export function renderRivers(map, riverGeoJson, activeStations, prevRiverLayer) {
    if (prevRiverLayer) { map.removeLayer(prevRiverLayer); }
    if (!riverGeoJson || !riverGeoJson.features) return null;

    const riverFeatures = [];

    activeStations.forEach(st => {
        if (!st.station.riverName) return;
        const color = getWaterLevelColor(st.levelStatus);
        const targetRiver = riverGeoJson.features.find(f => f.properties?.name === st.station.riverName);
        if (!targetRiver) return;

        let sliced = targetRiver;
        if (st.station.coverageKm && targetRiver.geometry.type === 'LineString') {
            try {
                const pt = turf.point([st.lon, st.lat]);
                const length = turf.length(targetRiver, { units: 'kilometers' });
                const linePt = turf.nearestPointOnLine(targetRiver, pt);
                const distToPt = turf.length(
                    turf.lineSlice(turf.point(targetRiver.geometry.coordinates[0]), linePt, targetRiver),
                    { units: 'kilometers' }
                );
                const startDist = Math.max(0, distToPt - st.station.coverageKm / 2);
                const endDist   = Math.min(length, distToPt + st.station.coverageKm / 2);
                sliced = turf.lineSliceAlong(targetRiver, startDist, endDist, { units: 'kilometers' });
            } catch(e) {
                console.warn('Failed to slice river feature', e);
            }
        }

        riverFeatures.push({
            type: 'Feature',
            properties: { color, weight: st.levelStatus === 'normal' ? 3 : 5 },
            geometry: sliced.geometry
        });
    });

    return L.geoJson({ type: 'FeatureCollection', features: riverFeatures }, {
        style: f => ({ color: f.properties.color, weight: f.properties.weight, opacity: 0.85 })
    }).addTo(map);
}
