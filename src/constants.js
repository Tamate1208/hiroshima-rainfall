// --- 定数定義 (src/constants.js) ---

export const ADOPTION_CRITERIA = {
    max24: 80,     // mm/24h — 公共土木・農地等
    max60: 20,     // mm/1h
    current: 20,   // mm/1h - リアルタイム60分雨量
    cumulative: null
};

// --- 雨量指標 R' パラメータ (広島・花崗岩地帯 ※暫定値) ---
export const RPRIME_PARAMS = {
    N:    72,    // Rw 半減期 (時間)
    M:    1.5,   // rw 半減期 (時間)
    R1:   300,   // 楕円中心 Rw (mm)
    r1:   60,    // 楕円中心 rw (mm)
    A:    3.0,   // 短期/長期 重み係数
};

// R' 危険閾値 (広島花崗岩地帯)
export const RPRIME_THRESHOLDS = {
    danger:  250,  // 土石流発生開始
    caution: 175,  // 山地崩壊発生開始
    watch:   125,  // がけ崩れ発生開始
};

// 監視雨量強度 R_R 危険ランク閾値 (小さいほど危険)
export const RR_THRESHOLDS = {
    A: 30,   // 極めて危険 (≤30mm)
    B: 50,   // 危険 (30〜50mm)
    C: 70,   // 要注意 (50〜70mm)
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
    cols: 150,
    rows: 120
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
