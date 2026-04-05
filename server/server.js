const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5500;

app.use(cors());
app.use(express.json());

// プロジェクトルート（server/ の一つ上のディレクトリ）から静的ファイルを配信
const PROJECT_ROOT = path.join(__dirname, '..');
app.use(express.static(PROJECT_ROOT));

// node_modules を ESM インポート用に公開
app.use('/node_modules', express.static(path.join(PROJECT_ROOT, 'node_modules')));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// データ更新エンドポイント — 広島県サイトから xlsx をダウンロードして処理
app.post('/api/update-data', (req, res) => {
    const { start, end } = req.body;
    console.log(`[API] Update requested: ${start} to ${end}`);

    if (!start || !end) {
        return res.status(400).json({ error: '開始日と終了日を指定してください' });
    }

    // process_data.js はプロジェクトルートに配置
    const scriptPath = path.join(PROJECT_ROOT, 'process_data.js');

    // spawn でストリーミング出力を取得しタイムアウトを回避
    const child = spawn('node', [scriptPath, start, end], {
        cwd: PROJECT_ROOT
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
        const msg = data.toString();
        stdout += msg;
        console.log(`[process] ${msg.trim()}`);
    });

    child.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[process error] ${data}`);
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`[API] Process exited with code ${code}`);
            return res.status(500).json({ error: `プロセスがエラーで終了しました (code ${code})`, stderr });
        }
        console.log('[API] Data processing complete');
        res.json({ message: 'Success', stdout });
    });

    child.on('error', (err) => {
        console.error(`[API] Spawn error: ${err}`);
        res.status(500).json({ error: err.message });
    });
});

app.listen(port, () => {
    console.log(`\n🌧  広島県内雨量可視＋`);
    console.log(`   http://localhost:${port}\n`);
});
