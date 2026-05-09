// --- WebWorker: TPS補間 + 等雨量線計算 (src/interpolation.worker.js) ---
// Phase 3-B: メインスレッドのブロックを防ぎ、アニメーション再生時のカクつきを解消

import { buildSmoothGrid } from './interpolation.js';
import { getIsolines } from './contour.js';
import { THRESHOLDS_BY_MODE } from './constants.js';

// ジョブキャンセル管理: 最新のジョブIDのみ結果を返す
let _latestJobId = -1;

self.onmessage = ({ data }) => {
    const { jobId, stations, mode } = data;
    _latestJobId = jobId;

    const grid = buildSmoothGrid(stations);

    // 古いジョブは破棄
    if (jobId !== _latestJobId) return;

    const thresholds = THRESHOLDS_BY_MODE[mode] || [1, 5, 10, 20, 30, 50, 80, 100];
    const isohyets = getIsolines(grid, thresholds);

    if (jobId !== _latestJobId) return;

    // Float32Array は Transferable で効率的に転送
    self.postMessage({ jobId, isohyets, grid }, [grid.buffer]);
};
