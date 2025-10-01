const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// 接続管理
const connections = new Map();

wss.on('connection', (ws) => {
    console.log('新しいクライアントが接続しました');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('メッセージ解析エラー:', error);
            sendError(ws, '無効なメッセージ形式');
        }
    });

    ws.on('close', () => {
        // 接続をマップから削除
        for (const [id, connection] of connections.entries()) {
            if (connection.ws === ws) {
                connections.delete(id);
                console.log(`接続 ${id} が切断されました`);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocketエラー:', error);
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'connect':
            handleConnect(ws, data);
            break;
        case 'sync':
            handleSync(ws, data);
            break;
        default:
            sendError(ws, '未知のメッセージタイプ');
    }
}

function handleConnect(ws, data) {
    const { role, id } = data;

    if (!id || id.length !== 3 || !/^\d+$/.test(id)) {
        sendError(ws, '無効なID形式');
        return;
    }

    // 送信者の場合、既存の接続をチェック
    if (role === 'sender') {
        const existingSender = connections.get(id);
        if (existingSender && existingSender.role === 'sender') {
            sendError(ws, 'このIDは既に使用されています');
            return;
        }
    }

    // 受信者の場合、対応する送信者が存在するかチェック
    if (role === 'receiver') {
        const sender = connections.get(id);
        if (!sender || sender.role !== 'sender') {
            sendError(ws, '対応する送信者が見つかりません');
            return;
        }
    }

    // 接続を登録
    connections.set(id, {
        ws,
        role,
        id,
        connectedAt: new Date()
    });

    // 接続成功を通知
    ws.send(JSON.stringify({
        type: 'connected',
        message: '接続に成功しました'
    }));

    console.log(`${role}がID ${id} で接続しました`);

    // 受信者の場合、送信者に通知
    if (role === 'receiver') {
        const sender = connections.get(id);
        if (sender && sender.ws.readyState === WebSocket.OPEN) {
            sender.ws.send(JSON.stringify({
                type: 'receiver_connected',
                message: '受信者が接続しました'
            }));
        }
    }
}

function handleSync(ws, data) {
    // 送信者からの同期メッセージを対応する受信者に転送
    const connection = findConnectionByWebSocket(ws);
    if (!connection || connection.role !== 'sender') {
        sendError(ws, '同期メッセージは送信者のみ送信可能です');
        return;
    }

    // 同じIDの受信者にメッセージを転送
    for (const [id, conn] of connections.entries()) {
        if (id === connection.id && conn.role === 'receiver' && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({
                type: 'sync',
                currentTime: data.currentTime,
                isPlaying: data.isPlaying,
                loop: data.loop,
                startTime: data.startTime,
                endTime: data.endTime
            }));
        }
    }
}

function findConnectionByWebSocket(ws) {
    for (const connection of connections.values()) {
        if (connection.ws === ws) {
            return connection;
        }
    }
    return null;
}

function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'error',
            message: message
        }));
    }
}

// 定期的な接続チェック
setInterval(() => {
    for (const [id, connection] of connections.entries()) {
        if (connection.ws.readyState !== WebSocket.OPEN) {
            connections.delete(id);
            console.log(`死んでいる接続 ${id} を削除しました`);
        }
    }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
});
