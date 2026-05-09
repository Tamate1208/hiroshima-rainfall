// --- 定数定義 (src/constants.js) ---

export const ADOPTION_CRITERIA = {
    max24: 80,     // mm/24h — 公共土木・農地等
    max60: 20,     // mm/1h
    current: null,
    cumulative: null
};

export const THRESHOLDS_BY_MODE = {
    current:    [1, 5, 10, 20],
    max60:      [1, 5, 10, 20, 30, 50],
    max24:      [10, 20, 50, 80, 100, 150, 200, 250],
    cumulative: [10, 50, 100, 200, 300, 400, 500]
};

export const GRID = {
    minLon: 131.8, maxLon: 133.6,
    minLat: 33.9,  maxLat: 35.3,
    cols: 100,
    rows: 80
};

export const LON_STEP = (GRID.maxLon - GRID.minLon) / GRID.cols;
export const LAT_STEP = (GRID.maxLat - GRID.minLat) / GRID.rows;

export const TPS_CONFIG = {
    LAMBDA: 1.0,         // 平滑化係数
    AGGREGATION_KM: 3.0  // 近接局統合距離しきい値
};

// 外挿域マスク: 凸包バッファ半径 (km)
export const CONVEX_BUFFER_KM = 10;

// 等雨量線の距離減衰設定
export const DECAY = {
    START_KM: 20,
    END_KM:   60
};

// IDW上限バッファ余裕率
export const IDW_UPPER_MARGIN = 1.1;
export const IDW_POWER = 2.5;
export const IDW_EPSILON = 0.1;
