# -*- coding: utf-8 -*-
"""
check_csv_vs_system.py
県内雨量局.csv と mapping.json の座標照合

マッチング戦略:
  1. (市区町, 局名) の完全一致
  2. 局名のみ完全一致
  3. 局名の部分一致（括弧内機関名などを除去して比較）

距離判定基準:
  100m 未満  → 正常
  100m ～ 500m → 要注意
  500m 以上  → 問題あり
  未マッチ   → 要確認
"""

import json
import csv
import io
import sys
import math
import re
from collections import defaultdict

CSV_PATH = "県内雨量局.csv"
MAPPING_PATH = "mapping.json"

THRESH_CAUTION = 100    # m
THRESH_PROBLEM = 500    # m


def haversine(lat1, lon1, lat2, lon2):
    """2点間の距離をメートルで返す（Haversine公式）"""
    R = 6371000  # 地球半径(m)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def normalize_name(name):
    """括弧部分を除去して局名を正規化"""
    return re.sub(r'[（(][^）)]*[）)]', '', name).strip()


def load_csv(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("cp932")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        try:
            rows.append({
                "name": row["雨量局"].strip(),
                "city": row["市区町"].strip(),
                "lat": float(row["緯度"].strip()),
                "lon": float(row["経度"].strip()),
            })
        except (ValueError, KeyError):
            pass
    return rows


def load_mapping(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data  # [{row, city, name, lat, lon}, ...]


def build_lookup(mapping):
    """lookupテーブルを構築"""
    by_city_name = {}   # (city, name) -> entry
    by_name = defaultdict(list)  # name -> [entries]
    by_norm_name = defaultdict(list)  # normalized_name -> [entries]

    for entry in mapping:
        key = (entry.get("city", ""), entry.get("name", ""))
        by_city_name[key] = entry
        by_name[entry.get("name", "")].append(entry)
        norm = normalize_name(entry.get("name", ""))
        by_norm_name[norm].append(entry)

    return by_city_name, by_name, by_norm_name


def match_station(csv_row, by_city_name, by_name, by_norm_name):
    """CSVの1局をmappingにマッチング。(match_entry, method) を返す"""
    name = csv_row["name"]
    city = csv_row["city"]
    norm = normalize_name(name)

    # 1. (city, name) 完全一致
    key = (city, name)
    if key in by_city_name:
        return by_city_name[key], "完全一致(市+局名)"

    # 2. 局名のみ完全一致（1件に絞れる場合）
    if name in by_name and len(by_name[name]) == 1:
        return by_name[name][0], "完全一致(局名のみ)"

    # 3. 正規化名で完全一致
    if norm and norm in by_norm_name and len(by_norm_name[norm]) == 1:
        return by_norm_name[norm][0], "正規化一致"

    # 4. 正規化したCSV局名を各mappingエントリの正規化名で探す
    #    （複数ヒットは ambiguous として最も近いものを採用しない → 未マッチ扱い）
    candidates = by_norm_name.get(norm, [])
    if len(candidates) > 1:
        return None, f"曖昧({len(candidates)}件)"

    return None, "未マッチ"


def classify(dist_m):
    if dist_m < THRESH_CAUTION:
        return "正常"
    elif dist_m < THRESH_PROBLEM:
        return "要注意"
    else:
        return "問題あり"


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    print("=" * 70)
    print("CSV vs 現システム（mapping.json）座標照合")
    print("=" * 70)

    csv_rows = load_csv(CSV_PATH)
    mapping = load_mapping(MAPPING_PATH)

    print(f"CSV: {len(csv_rows)}局 / mapping.json: {len(mapping)}件")

    by_city_name, by_name, by_norm_name = build_lookup(mapping)

    # 照合結果
    results = []
    matched_mapping_rows = set()

    for csv_row in csv_rows:
        match, method = match_station(csv_row, by_city_name, by_name, by_norm_name)
        if match:
            dist = haversine(csv_row["lat"], csv_row["lon"], match["lat"], match["lon"])
            dlat = match["lat"] - csv_row["lat"]
            dlon = match["lon"] - csv_row["lon"]
            status = classify(dist)
            matched_mapping_rows.add(match.get("row"))
            results.append({
                "csv_name": csv_row["name"],
                "csv_city": csv_row["city"],
                "csv_lat": csv_row["lat"],
                "csv_lon": csv_row["lon"],
                "sys_name": match["name"],
                "sys_city": match.get("city", ""),
                "sys_lat": match["lat"],
                "sys_lon": match["lon"],
                "dlat": dlat,
                "dlon": dlon,
                "dist_m": dist,
                "method": method,
                "status": status,
            })
        else:
            results.append({
                "csv_name": csv_row["name"],
                "csv_city": csv_row["city"],
                "csv_lat": csv_row["lat"],
                "csv_lon": csv_row["lon"],
                "sys_name": None,
                "method": method,
                "status": "未マッチ",
                "dist_m": None,
            })

    # CSVにない（systemのみ）の局
    unmatched_sys = [m for m in mapping if m.get("row") not in matched_mapping_rows]

    # 集計表示
    status_count = defaultdict(int)
    for r in results:
        status_count[r["status"]] += 1

    print(f"\n【照合結果サマリー】")
    labels = {"正常": "✅", "要注意": "⚠️ ", "問題あり": "❌", "未マッチ": "❓", "曖昧(2件)": "❓"}
    for status, count in sorted(status_count.items()):
        icon = labels.get(status, "❓")
        print(f"  {icon} {status}: {count}件")
    print(f"  📌 システムのみ（CSV未登録）: {len(unmatched_sys)}件")

    # 問題あり詳細
    problems = [r for r in results if r["status"] == "問題あり"]
    if problems:
        print(f"\n【問題あり（{len(problems)}件）- 距離差が{THRESH_PROBLEM}m以上】")
        for r in sorted(problems, key=lambda x: -x["dist_m"]):
            print(f"  ❌ {r['csv_city']} / {r['csv_name']}")
            print(f"      CSV座標: ({r['csv_lat']:.6f}, {r['csv_lon']:.6f})")
            print(f"      SYS座標: ({r['sys_lat']:.6f}, {r['sys_lon']:.6f})")
            print(f"      距離差: {r['dist_m']:.0f}m  [{r['method']}]")

    # 要注意詳細
    cautions = [r for r in results if r["status"] == "要注意"]
    if cautions:
        print(f"\n【要注意（{len(cautions)}件）- 距離差 {THRESH_CAUTION}m〜{THRESH_PROBLEM}m】")
        for r in sorted(cautions, key=lambda x: -x["dist_m"]):
            print(f"  ⚠️  {r['csv_city']} / {r['csv_name']}: {r['dist_m']:.0f}m [{r['method']}]")

    # 未マッチ
    unmatched_csv = [r for r in results if r["status"] == "未マッチ"]
    ambiguous = [r for r in results if r["status"].startswith("曖昧")]
    if unmatched_csv or ambiguous:
        print(f"\n【CSVで未マッチ（{len(unmatched_csv) + len(ambiguous)}件）】")
        for r in unmatched_csv + ambiguous:
            print(f"  ❓ {r['csv_city']} / {r['csv_name']} ({r['method']})")

    if unmatched_sys:
        print(f"\n【システムのみの局（CSV未登録, {len(unmatched_sys)}件）】")
        for m in unmatched_sys[:20]:
            print(f"  📌 {m.get('city','')} / {m['name']}")
        if len(unmatched_sys) > 20:
            print(f"  ... 他 {len(unmatched_sys)-20}件")

    print("\n" + "=" * 70)
    print("照合完了")
    print("=" * 70)

    # 結果をグローバルに返す（generate_coord_reportから参照可能にする）
    return results, unmatched_sys


if __name__ == "__main__":
    main()
