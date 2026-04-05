# -*- coding: utf-8 -*-
"""
check_json_vs_system.py
rainfallObservatory.json (Web最新) を「正」として、
1. mapping.json (現システム)
2. 県内雨量局.csv (提供CSV)
の座標を照合する。
"""

import json
import csv
import io
import sys
import math
import re
from collections import defaultdict

JSON_PATH = "rainfallObservatory.json"
MAPPING_PATH = "mapping.json"
CSV_PATH = "県内雨量局.csv"
OUTPUT_PATH = "report_coord_triple_check.csv"

# 判定しきい値(m)
THRESH_OK = 100
THRESH_PROBLEM = 500

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlam = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def normalize_text(text):
    if not text: return ""
    # カタカナ半角→全角などの処理は省くが、空白と括弧内の除去を行う
    text = re.sub(r'[（(][^）)]*[）)]', '', text)
    # 特殊な文字化け(?)の除去（JSONに含まれる 庁E市 など）
    text = re.sub(r'[A-Z]E', '', text) 
    return text.replace(" ", "").replace("　", "").strip()

def load_web_json(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    items = data.get("items", [])
    results = []
    for it in items:
        results.append({
            "id": it.get("observatoryId"),
            "name": it.get("observatoryName", ""),
            "city": it.get("municipalityName", ""),
            "lat": float(it.get("latitude", 0)),
            "lon": float(it.get("longitude", 0)),
            "orig": it
        })
    return results

def load_system_mapping(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def load_provided_csv(path):
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
        except:
            pass
    return rows

def build_lookup(list_data, name_field="name", city_field="city"):
    lookup = defaultdict(list)
    for item in list_data:
        name = normalize_text(item.get(name_field, ""))
        city = normalize_text(item.get(city_field, ""))
        lookup[(city, name)].append(item)
    return lookup

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print("="*80)
    print("Web JSON (rainfallObservatory.json) vs System vs Provided CSV")
    print("="*80)

    web_data = load_web_json(JSON_PATH)
    sys_data = load_system_mapping(MAPPING_PATH)
    csv_data = load_provided_csv(CSV_PATH)

    print(f"Web JSON: {len(web_data)} stations")
    print(f"System mapping: {len(sys_data)} stations")
    print(f"Provided CSV: {len(csv_data)} stations")

    sys_lookup = build_lookup(sys_data)
    csv_lookup = build_lookup(csv_data)

    report = []
    summary = {"total": 0, "all_match": 0, "sys_diff": 0, "csv_diff": 0, "not_found": 0}

    for web in web_data:
        summary["total"] += 1
        w_lat, w_lon = web["lat"], web["lon"]
        w_name = normalize_text(web["name"])
        w_city = normalize_text(web["city"])
        
        # Match with system
        s_matches = sys_lookup.get((w_city, w_name)) or sys_lookup.get(("", w_name))
        s_match = s_matches[0] if s_matches else None
        
        # Match with CSV
        c_matches = csv_lookup.get((w_city, w_name)) or csv_lookup.get(("", w_name))
        c_match = c_matches[0] if c_matches else None

        s_dist = haversine(w_lat, w_lon, s_match["lat"], s_match["lon"]) if s_match else None
        c_dist = haversine(w_lat, w_lon, c_match["lat"], c_match["lon"]) if c_match else None

        status = "OK"
        if not s_match or not c_match:
            status = "MISSING"
            summary["not_found"] += 1
        elif s_dist > THRESH_OK or c_dist > THRESH_OK:
            status = "DIFF"
            if s_dist > THRESH_OK: summary["sys_diff"] += 1
            if c_dist > THRESH_OK: summary["csv_diff"] += 1
        else:
            summary["all_match"] += 1

        report.append({
            "ID": web["id"],
            "City": web["city"],
            "Name": web["name"],
            "Web_Lat": w_lat,
            "Web_Lon": w_lon,
            "Sys_Name": s_match["name"] if s_match else "N/A",
            "Sys_Dist": round(s_dist, 1) if s_dist is not None else "",
            "CSV_Name": c_match["name"] if c_match else "N/A",
            "CSV_Dist": round(c_dist, 1) if c_dist is not None else "",
            "Status": status
        })

    # Save report
    with open(OUTPUT_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=report[0].keys())
        writer.writeheader()
        writer.writerows(report)

    print("\n【照合サマリー (Web JSONを正とする)】")
    print(f"  全一致 (誤差100m内) : {summary['all_match']} / {len(web_data)}")
    print(f"  システムに差異あり   : {summary['sys_diff']} 局")
    print(f"  提供CSVに差異あり    : {summary['csv_diff']} 局")
    print(f"  マッチ失敗           : {summary['not_found']} 局")

    # Significant differences list (Sys)
    print("\n【システムとの大規模な差異 (>500m)】")
    found_big = False
    for r in report:
        if r["Sys_Dist"] and r["Sys_Dist"] > THRESH_PROBLEM:
            print(f"  - {r['City']} / {r['Name']}: {r['Sys_Dist']}m (SYS: {r['Sys_Name']})")
            found_big = True
    if not found_big: print("  なし")

    # Significant differences list (CSV)
    print("\n【提供CSVとの大規模な差異 (>500m)】")
    found_big_csv = False
    for r in report:
        if r["CSV_Dist"] and r["CSV_Dist"] > THRESH_PROBLEM:
            print(f"  - {r['City']} / {r['Name']}: {r['CSV_Dist']}m (CSV: {r['CSV_Name']})")
            found_big_csv = True
    if not found_big_csv: print("  なし")

    print(f"\n✅ 詳細レポートを書き出しました: {OUTPUT_PATH}")
    print("="*80)

if __name__ == "__main__":
    main()
