import WebSocket from 'ws';

export function connect(symbol, callback) {
    let ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${symbol}@bookTicker`);
    ws.on('open', () => {
        console.log('[Web Socket] ' + symbol + ' connected');
    });

    ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        const d = msg.data;
        if (d?.e) {
            callback(symbol, d);
        }
    });

    // Binance 会发 ping 帧，客户端需回复 pong
    ws.on('ping', (data) => {
        try {
            ws.pong(data);
        } catch (e) {
            console.warn('[pong error]', e?.message);
        }
    });

    // 当服务器关闭时，自动重连
    ws.on('close', (code, reason) => {
        console.warn(`[close] code=${code} reason=${reason?.toString() || 'no reason'}`);
        console.log('[reconnect] reconnecting in 2s...');
    });

    ws.on('error', (err) => {
        console.error('[error]', err?.message || err);
        setTimeout(() => {
            connect(symbol, callback);
        }, 2000);
    });
    return ws;
}



