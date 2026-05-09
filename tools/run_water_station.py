"""
水位局データ作成.py.txt のラッパー実行スクリプト
オリジナルスクリプトのパスと出力先をローカル環境用に修正して実行する
"""
import os
import sys

# パス設定
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source_script = os.path.join(project_root, 'water_station.txt')
output_csv    = os.path.join(project_root, 'water_stations.csv')

# オリジナルスクリプトを読み込み
try:
    with open(source_script, 'r', encoding='utf-8') as f:
        code = f.read()
except FileNotFoundError:
    print(f'エラー: {source_script} が見つかりません')
    sys.exit(1)

# Claude 環境の出力パスをローカルパスに置換
code = code.replace(
    "'/mnt/user-data/outputs/hiroshima_water_stations.csv'",
    repr(output_csv).replace('\\\\', '\\')
)

# スクリプトのバグ修正: raw_lines という変数名で定義されているのに csv_data を参照している
code = code.replace('csv_data.strip()', 'raw_lines.strip()')

# スクリプト末尾の不要な文字列 (PYEOF, python3 コマンドなど) を削除
lines = code.split('\n')
clean_lines = [l for l in lines if not l.startswith('PYEOF') and not l.startswith('python3')]
code = '\n'.join(clean_lines)


# バックスラッシュを正規化
code = code.replace(
    f"open({repr(output_csv).replace(chr(92)*2, chr(92))}",
    f"open(r'{output_csv}'"
)

# 修正後コードを一時ファイルに保存してデバッグしやすくする
temp_path = os.path.join(project_root, 'tmp', 'water_station_exec.py')
os.makedirs(os.path.dirname(temp_path), exist_ok=True)
with open(temp_path, 'w', encoding='utf-8') as f:
    f.write(code)

print(f'実行スクリプト: {temp_path}')
print(f'出力先: {output_csv}')
print('---')

# スクリプトを実行
exec(compile(code, temp_path, 'exec'))

print(f'\n✅ 完了: {output_csv}')
