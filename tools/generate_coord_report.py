# -*- coding: utf-8 -*-
"""
generate_coord_report.py
座標チェック結果のCSVレポートを生成する

出力:
  report_coord_diff.csv  - マッチした局の座標差分一覧
  report_missing.csv     - 未マッチ局（CSVのみ / システムのみ）
  report_coord_dup.csv   - CSV内の座標重複
"""

import csv
import io
import json
import math
import re
import sys
from collections import defaultdict

CSV_PATH = "県内雨量局.csv"
MAPPING_PATH = "mapping.json"

THRESH_CAUTION = 100
THRESH_PROBLEM = 500


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlam = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def normalize_name(name):
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
        return json.load(f)


def build_lookup(mapping):
    by_city_name = {}
    by_name = defaultdict(list)
    by_norm_name = defaultdict(list)
    for entry in mapping:
        key = (entry.get("city", ""), entry.get("name", ""))
        by_city_name[key] = entry
        by_name[entry.get("name", "")].append(entry)
        norm = normalize_name(entry.get("name", ""))
        by_norm_name[norm].append(entry)
    return by_city_name, by_name, by_norm_name


def match_station(csv_row, by_city_name, by_name, by_norm_name):
    name = csv_row["name"]
    city = csv_row["city"]
    norm = normalize_name(name)
    key = (city, name)
    if key in by_city_name:
        return by_city_name[key], "完全一致(市+局名)"
    if name in by_name and len(by_name[name]) == 1:
        return by_name[name][0], "完全一致(局名のみ)"
    if norm and norm in by_norm_name and len(by_norm_name[norm]) == 1:
        return by_norm_name[norm][0], "正規化一致"
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


def run():
    csv_rows = load_csv(CSV_PATH)
    mapping = load_mapping(MAPPING_PATH)
    by_city_name, by_name, by_norm_name = build_lookup(mapping)

    diff_rows = []
    missing_rows = []
    matched_rows = set()

    for csv_row in csv_rows:
        match, method = match_station(csv_row, by_city_name, by_name, by_norm_name)
        if match:
            dist = haversine(csv_row["lat"], csv_row["lon"], match["lat"], match["lon"])
            dlat = match["lat"] - csv_row["lat"]
            dlon = match["lon"] - csv_row["lon"]
            status = classify(dist)
            matched_rows.add(match.get("row"))
            diff_rows.append({
                "市区町": csv_row["city"],
                "CSV局名": csv_row["name"],
                "システム局名": match["name"],
                "CSV緯度": csv_row["lat"],
                "CSV経度": csv_row["lon"],
                "SYS緯度": match["lat"],
                "SYS経度": match["lon"],
                "Δ緯度": round(dlat, 6),
                "Δ経度": round(dlon, 6),
                "距離差(m)": round(dist, 1),
                "マッチ方法": method,
                "判定": status,
            })
        else:
            missing_rows.append({
                "分類": "CSVのみ(システム未登録)",
                "市区町": csv_row["city"],
                "局名": csv_row["name"],
                "CSV緯度": csv_row["lat"],
                "CSV経度": csv_row["lon"],
                "備考": method,
            })

    # システムのみの局
    unmatched_sys = [m for m in mapping if m.get("row") not in matched_rows]
    for m in unmatched_sys:
        missing_rows.append({
            "分類": "システムのみ(CSV未登録)",
            "市区町": m.get("city", ""),
            "局名": m["name"],
            "CSV緯度": "",
            "CSV経度": "",
            "備考": "",
        })

    # CSV内の座標重複
    coord_map = defaultdict(list)
    for r in csv_rows:
        key = (round(r["lat"], 6), round(r["lon"], 6))
        coord_map[key].append(f"{r['city']}/{r['name']}")
    dup_rows = []
    for (lat, lon), stations in coord_map.items():
        if len(stations) > 1:
            dup_rows.append({
                "緯度": lat,
                "経度": lon,
                "局数": len(stations),
                "局一覧": " | ".join(stations),
            })

    return diff_rows, missing_rows, dup_rows


def write_report(diff_rows, missing_rows, dup_rows):
    # report_coord_diff.csv（距離差の大きい順）
    out1 = "report_coord_diff.csv"
    sorted_diff = sorted(diff_rows, key=lambda x: -x["距離差(m)"])
    with open(out1, "w", encoding="utf-8-sig", newline="") as f:
        if sorted_diff:
            writer = csv.DictWriter(f, fieldnames=list(sorted_diff[0].keys()))
            writer.writeheader()
            writer.writerows(sorted_diff)
    print(f"✅ {out1} ({len(sorted_diff)}件)")

    # report_missing.csv
    out2 = "report_missing.csv"
    with open(out2, "w", encoding="utf-8-sig", newline="") as f:
        if missing_rows:
            writer = csv.DictWriter(f, fieldnames=list(missing_rows[0].keys()))
            writer.writeheader()
            writer.writerows(missing_rows)
    print(f"✅ {out2} ({len(missing_rows)}件)")

    # report_coord_dup.csv
    out3 = "report_coord_dup.csv"
    with open(out3, "w", encoding="utf-8-sig", newline="") as f:
        if dup_rows:
            writer = csv.DictWriter(f, fieldnames=list(dup_rows[0].keys()))
            writer.writeheader()
            writer.writerows(dup_rows)
    print(f"✅ {out3} ({len(dup_rows)}件)")

    # サマリー表示
    total = len(diff_rows)
    normal = sum(1 for r in diff_rows if r["判定"] == "正常")
    caution = sum(1 for r in diff_rows if r["判定"] == "要注意")
    problem = sum(1 for r in diff_rows if r["判定"] == "問題あり")
    csv_only = sum(1 for r in missing_rows if r["分類"].startswith("CSVのみ"))
    sys_only = sum(1 for r in missing_rows if r["分類"].startswith("システムのみ"))

    print()
    print("=" * 50)
    print("【レポートサマリー】")
    print(f"  ✅ 正常      : {normal:3d} 件")
    print(f"  ⚠️  要注意    : {caution:3d} 件  (差分 {THRESH_CAUTION}m〜{THRESH_PROBLEM}m)")
    print(f"  ❌ 問題あり  : {problem:3d} 件  (差分 {THRESH_PROBLEM}m以上)")
    print(f"  ❓ CSVのみ   : {csv_only:3d} 件")
    print(f"  📌 SYSのみ   : {sys_only:3d} 件")
    print(f"  🔁 座標重複  : {len(dup_rows):3d} 件")
    print("=" * 50)

    # 問題あり詳細
    problems = [r for r in diff_rows if r["判定"] == "問題あり"]
    if problems:
        print("\n【問題あり 詳細】")
        for r in sorted(problems, key=lambda x: -x["距離差(m)"]):
            print(f"  ❌ {r['市区町']} / {r['CSV局名']}")
            print(f"      CSV: ({r['CSV緯度']:.6f}, {r['CSV経度']:.6f})")
            print(f"      SYS: ({r['SYS緯度']:.6f}, {r['SYS経度']:.6f})")
            print(f"      距離差: {r['距離差(m)']:.0f}m  [{r['マッチ方法']}]")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print("=" * 50)
    print("座標チェック レポート生成")
    print("=" * 50)

    diff_rows, missing_rows, dup_rows = run()
    write_report(diff_rows, missing_rows, dup_rows)


if __name__ == "__main__":
    main()
