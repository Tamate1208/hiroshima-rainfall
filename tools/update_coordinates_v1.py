# -*- coding: utf-8 -*-
"""
update_coordinates_v1.py
Web公式データを基に、既存の399局の座標を一括更新する。
更新対象: mapping.json, kml_stations.json, 県内雨量局.csv
"""

import json
import csv
import io
import sys
import re
import os
from collections import defaultdict

JSON_PATH = "rainfallObservatory.json"
MAPPING_PATH = "mapping.json"
KML_PATH = "kml_stations.json"
CSV_PATH = "県内雨量局.csv"

def normalize(text):
    if not text: return ""
    text = re.sub(r'[（(][^）)]*[）)]', '', text)
    return text.replace(" ", "").replace("　", "").strip()

def load_web_master(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    items = data.get("items", [])
    web_map = {}
    # (City, Name) -> item
    for it in items:
        name = normalize(it.get("observatoryName", ""))
        city = normalize(it.get("municipalityName", ""))
        web_map[(city, name)] = it
    # Name only map (for fallback)
    web_name_map = {}
    for it in items:
        name = normalize(it.get("observatoryName", ""))
        web_name_map[name] = it
    return web_map, web_name_map

def update_mapping(web_map, web_name_map):
    with open(MAPPING_PATH, encoding="utf-8") as f:
        sys_data = json.load(f)
    
    updated_count = 0
    for s in sys_data:
        city = normalize(s.get("city", ""))
        name = normalize(s.get("name", ""))
        
        match = web_map.get((city, name)) or web_name_map.get(name)
        if match:
            s["lat"] = float(match["latitude"])
            s["lon"] = float(match["longitude"])
            updated_count += 1
            
    with open(MAPPING_PATH, "w", encoding="utf-8") as f:
        json.dump(sys_data, f, ensure_ascii=False, indent=2)
    return updated_count, sys_data

def update_kml(mapping_list):
    # kml_stations.json は mapping.json の Name, Lat, Lon と整合させるのが最も安全
    with open(KML_PATH, encoding="utf-8-sig") as f:
        kml_data = json.load(f)
        
    map_lookup = { m["name"]: (m["lat"], m["lon"]) for m in mapping_list }
    
    updated_count = 0
    for k in kml_data:
        name = k.get("Name")
        if name in map_lookup:
            k["Lat"], k["Lon"] = map_lookup[name]
            updated_count += 1
            
    with open(KML_PATH, "w", encoding="utf-8-sig") as f:
        json.dump(kml_data, f, ensure_ascii=False, indent=2)
    return updated_count

def update_csv(web_map, web_name_map):
    with open(CSV_PATH, "rb") as f:
        raw = f.read()
    text = raw.decode("cp932")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    fieldnames = reader.fieldnames
    
    updated_count = 0
    for row in rows:
        city = normalize(row.get("市区町", ""))
        name = normalize(row.get("雨量局", ""))
        
        match = web_map.get((city, name)) or web_name_map.get(name)
        if match:
            row["緯度"] = str(match["latitude"])
            row["経度"] = str(match["longitude"])
            updated_count += 1
            
    with open(CSV_PATH, "w", encoding="cp932", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return updated_count

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print("="*60)
    print("座標一括更新 (一致局のみ)")
    print("="*60)
    
    web_map, web_name_map = load_web_master(JSON_PATH)
    
    # 1. mapping.json
    m_count, updated_mapping = update_mapping(web_map, web_name_map)
    print(f"✅ mapping.json      更新: {m_count}局")
    
    # 2. kml_stations.json
    k_count = update_kml(updated_mapping)
    print(f"✅ kml_stations.json  更新: {k_count}局")
    
    # 3. 県内雨量局.csv
    c_count = update_csv(web_map, web_name_map)
    print(f"✅ 県内雨量局.csv     更新: {c_count}局")
    
    print("\n完了!")

if __name__ == "__main__":
    main()
