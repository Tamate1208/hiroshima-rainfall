# -*- coding: utf-8 -*-
"""
check_csv_quality.py
県内雨量局.csv の基本品質チェック
- 緯度・経度の範囲チェック（広島県の概略範囲）
- 重複局名チェック（同一市区町内）
- 重複座標チェック（完全一致）
- 欠損値チェック
"""

import csv
import io
import sys
from collections import defaultdict

CSV_PATH = "県内雨量局.csv"

# 広島県の大まかな緯度経度範囲
LAT_MIN, LAT_MAX = 33.8, 35.2
LON_MIN, LON_MAX = 131.8, 133.7

def load_csv(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("cp932")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    return rows

def check_quality(rows):
    errors = []
    warnings = []

    # 座標重複チェック用
    coord_map = defaultdict(list)
    # 局名重複チェック用（市区町内）
    name_map = defaultdict(list)

    for i, row in enumerate(rows, 2):  # 2行目から（1行目はヘッダー）
        name = row.get("雨量局", "").strip()
        city = row.get("市区町", "").strip()
        lat_str = row.get("緯度", "").strip()
        lon_str = row.get("経度", "").strip()

        # 欠損値チェック
        if not name:
            errors.append(f"行{i}: 雨量局名が空")
        if not city:
            errors.append(f"行{i}: 市区町が空 (局名:{name})")
        if not lat_str or not lon_str:
            errors.append(f"行{i}: 緯度/経度が空 (局名:{name})")
            continue

        # 数値変換
        try:
            lat = float(lat_str)
            lon = float(lon_str)
        except ValueError:
            errors.append(f"行{i}: 緯度/経度が数値でない → lat='{lat_str}', lon='{lon_str}' (局名:{name})")
            continue

        # 範囲チェック
        if not (LAT_MIN <= lat <= LAT_MAX):
            errors.append(f"行{i}: 緯度が範囲外 lat={lat:.6f} (局名:{name}, {city})")
        if not (LON_MIN <= lon <= LON_MAX):
            errors.append(f"行{i}: 経度が範囲外 lon={lon:.6f} (局名:{name}, {city})")

        # 座標重複チェック
        coord_key = (round(lat, 6), round(lon, 6))
        coord_map[coord_key].append(f"{name}({city})[行{i}]")

        # 局名重複チェック（市区町単位）
        name_key = (city, name)
        name_map[name_key].append(i)

    # 重複座標を判定
    for coord, names in coord_map.items():
        if len(names) > 1:
            warnings.append(f"座標重複 lat={coord[0]}, lon={coord[1]} → {', '.join(names)}")

    # 局名重複（市区町内）
    for (city, name), lines in name_map.items():
        if len(lines) > 1:
            warnings.append(f"局名重複 [{city}] '{name}' → 行 {lines}")

    return errors, warnings

def main():
    print("=" * 60)
    print("県内雨量局.csv 基本品質チェック")
    print("=" * 60)

    rows = load_csv(CSV_PATH)
    print(f"\n読み込み完了: {len(rows)} 局")

    # 市区町別集計
    city_count = defaultdict(int)
    for row in rows:
        city_count[row.get("市区町", "").strip()] += 1
    print(f"市区町数: {len(city_count)}")
    print("\n【市区町別局数（上位10）】")
    for city, count in sorted(city_count.items(), key=lambda x: -x[1])[:10]:
        print(f"  {city}: {count}局")

    print(f"\n【緯度経度の概略統計】")
    lats = []
    lons = []
    for row in rows:
        try:
            lats.append(float(row["緯度"]))
            lons.append(float(row["経度"]))
        except:
            pass
    if lats:
        print(f"  緯度 min={min(lats):.6f}, max={max(lats):.6f}, 許容範囲=[{LAT_MIN}, {LAT_MAX}]")
        print(f"  経度 min={min(lons):.6f}, max={max(lons):.6f}, 許容範囲=[{LON_MIN}, {LON_MAX}]")

    errors, warnings = check_quality(rows)

    print(f"\n【エラー】 {len(errors)}件")
    if errors:
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  なし（良好）")

    print(f"\n【警告】 {len(warnings)}件")
    if warnings:
        for w in warnings:
            print(f"  ⚠️  {w}")
    else:
        print("  なし（良好）")

    print("\n" + "=" * 60)
    if not errors and not warnings:
        print("✅ チェック完了: 問題なし")
    elif errors:
        print(f"❌ チェック完了: エラー {len(errors)}件, 警告 {len(warnings)}件")
    else:
        print(f"⚠️  チェック完了: 警告 {len(warnings)}件")
    print("=" * 60)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
