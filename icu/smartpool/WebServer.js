import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';
import {readLatestBatch} from './service/SmartPoolMapper.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIEW_DIR = path.join(__dirname, 'view');
const ORDERS_PATH = path.join(__dirname, 'grid', 'data', 'orders.json');
const STAGE_KEYS = ['symbolList', 'rltArr', 'centerList', 'highList', 'lowList', 'highLowList', 'data'];

async function loadBatch() {
    const raw = await readLatestBatch();
    const parsed = JSON.parse(JSON.stringify(raw));
    const hasStageKeys = STAGE_KEYS.some(stageKey => Object.prototype.hasOwnProperty.call(parsed, stageKey));

    if (!hasStageKeys && parsed.data && typeof parsed.data === 'object') {
        const normalized = parsed.data;
        if (!normalized.timestamp && parsed.timestamp) {
            normalized.timestamp = parsed.timestamp;
        }
        if (!normalized.lastSavedAt && parsed.savedAt) {
            normalized.lastSavedAt = parsed.savedAt;
        }
        return normalized;
    }

    if (!parsed.lastSavedAt) {
        const latestStage = STAGE_KEYS.map(key => parsed[key])
            .filter(Boolean)
            .map(stage => stage.savedAt)
            .filter(Boolean)
            .sort()
            .pop();
        if (latestStage) {
            parsed.lastSavedAt = latestStage;
        }
    }

    return parsed;
}

function normalizeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizeOrder(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
    if (!symbol) {
        return null;
    }
    const side = typeof raw.side === 'string' ? raw.side.trim().toUpperCase() : '';
    const status = typeof raw.status === 'string' ? raw.status.trim().toUpperCase() : '';
    const price = normalizeNumber(raw.price);
    const quantity = normalizeNumber(raw.origQty);
    const updateTime = normalizeNumber(raw.updateTime);
    const synthPrice = normalizeNumber(raw.synthPrice);
    const txFee = normalizeNumber(raw.txFee);
    const baseDelta = Number.isFinite(quantity)
        ? (side === 'SELL' ? -quantity : side === 'BUY' ? quantity : 0)
        : 0;

    return {
        taskId: raw.taskId ?? null,
        taskBindId: raw.taskBindId ?? null,
        synthPrice,
        symbol,
        orderId: raw.orderId ?? null,
        side,
        status,
        price,
        priceRaw: typeof raw.price === 'string' ? raw.price : null,
        origQty: quantity,
        origQtyRaw: typeof raw.origQty === 'string' ? raw.origQty : null,
        updateTime,
        makerFeeRate: typeof raw.makerFeeRate === 'string' ? raw.makerFeeRate : null,
        txFee,
        baseDelta
    };
}

function handleReadError(res, err) {
    if (err && err.code === 'ENOENT') {
        res.status(404).json({error: '未找到批次数据'});
        return;
    }
    console.error('读取批次数据失败:', err);
    res.status(500).json({error: '服务器内部错误'});
}

function extractStage(data, stageName) {
    const stage = data[stageName];
    if (!stage) {
        return {savedAt: null, data: []};
    }
    return {savedAt: stage.savedAt || null, data: stage.data ?? stage};
}

function createFieldEndpoint(pathSuffix, stageName) {
    app.get(`/api/data/${pathSuffix}`, async (req, res) => {
        try {
            const batch = await loadBatch();
            const stage = extractStage(batch, stageName);
            res.json({
                stage: stageName,
                batchTimestamp: batch.timestamp,
                savedAt: stage.savedAt,
                data: stage.data,
                cycleHours: batch.cycleHours,
                cycleDays: batch.cycleDays
            });
        } catch (err) {
            handleReadError(res, err);
        }
    });
}

app.get('/api/data', async (req, res) => {
    try {
        const batch = await loadBatch();
        const stageSummary = STAGE_KEYS.map(stageName => {
            const stage = extractStage(batch, stageName);
            const value = stage.data;
            const size = Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0);
            return {
                stage: stageName,
                savedAt: stage.savedAt,
                size
            };
        });
        res.json({
            message: '最新批次数据',
            timestamp: batch.timestamp,
            savedAt: batch.lastSavedAt,
            cycleHours: batch.cycleHours,
            cycleDays: batch.cycleDays,
            stageSummary
        });
    } catch (err) {
        handleReadError(res, err);
    }
});

createFieldEndpoint('symbol-list', 'symbolList');
createFieldEndpoint('initial-results', 'rltArr');
createFieldEndpoint('center-list', 'centerList');
createFieldEndpoint('high-list', 'highList');
createFieldEndpoint('low-list', 'lowList');
createFieldEndpoint('pairs', 'highLowList');
createFieldEndpoint('final-results', 'data');

app.get('/api/orders', async (req, res) => {
    try {
        const [content, stats] = await Promise.all([
            fs.readFile(ORDERS_PATH, 'utf8'),
            fs.stat(ORDERS_PATH)
        ]);
        const parsed = JSON.parse(content || '{}');
        const rawOrders = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed.orders) ? parsed.orders : []);
        const orders = rawOrders.map(normalizeOrder).filter(Boolean);
        res.json({
            message: '订单列表',
            count: orders.length,
            savedAt: stats.mtime ? stats.mtime.toISOString() : null,
            orders
        });
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            res.status(404).json({error: '未找到订单数据'});
            return;
        }
        console.error('读取订单数据失败:', err);
        res.status(500).json({error: '服务器内部错误'});
    }
});

app.get('/', (req, res, next) => {
    res.sendFile(path.join(VIEW_DIR, 'home.html'), err => {
        if (err) {
            next(err);
        }
    });
});

app.get('/dashboard', (req, res, next) => {
    res.sendFile(path.join(VIEW_DIR, 'dashboard.html'), err => {
        if (err) {
            next(err);
        }
    });
});

app.use(express.static(__dirname));

app.use((req, res) => {
    res.status(404).send('Not Found');
});

app.listen(PORT, () => {
    console.log(`首页 http://localhost:${PORT}`);
    console.log(`双币网格任务数据面板 http://localhost:${PORT}/dashboard`);
});
