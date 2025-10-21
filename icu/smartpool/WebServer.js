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
const ORDERS_DIR = path.join(__dirname, 'grid', 'data');
const ORDER_FILE_REGEX = /^orders-(.+)\.json$/i;
const STAGE_KEYS = ['symbolList', 'rltArr', 'centerList', 'highList', 'lowList', 'highLowList', 'data'];

async function loadBatch() {
    const raw = await readLatestBatch();
    return raw && typeof raw === 'object' ? raw : {};
}

// 根据请求参数挑选合适的周期数据
function resolveCycle(batch, requestedCycle) {
    const cycles = batch.cycles || {};
    const cycleKeys = Object.keys(cycles);
    if (!cycleKeys.length) {
        return {cycle: null, cycleKey: null, cycleList: []};
    }
    const requestedKey = requestedCycle ? String(requestedCycle) : null;
    const defaultKey = batch.defaultCycleKey && cycles[batch.defaultCycleKey] ? batch.defaultCycleKey : null;
    const cycleKey = (requestedKey && cycles[requestedKey])
        ? requestedKey
        : (defaultKey ?? cycleKeys[0]);
    const cycle = cycles[cycleKey];
    const cycleList = cycleKeys
        .map(key => {
            const entry = cycles[key];
            return {
                cycleKey: key,
                cycleHours: entry.cycleHours,
                cycleDays: entry.cycleDays ?? (entry.cycleHours / 24),
                lastSavedAt: entry.lastSavedAt ?? null
            };
        })
        .sort((a, b) => b.cycleHours - a.cycleHours);
    return {cycle, cycleKey, cycleList};
}

// 统一格式化阶段数据，兼容无数据情况
function extractStage(cycle, stageName) {
    if (!cycle) {
        return {savedAt: null, data: []};
    }
    const stage = cycle[stageName];
    if (!stage) {
        return {savedAt: null, data: []};
    }
    return {
        savedAt: stage.savedAt ?? null,
        data: stage.data ?? []
    };
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

async function listOrderFiles() {
    try {
        const entries = await fs.readdir(ORDERS_DIR, {withFileTypes: true});
        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => ORDER_FILE_REGEX.test(name));
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

async function readOrdersForTask(taskId) {
    if (!taskId || typeof taskId !== 'string') {
        throw Object.assign(new Error('taskId is required'), {code: 'EINVAL'});
    }
    const sanitizedTaskId = taskId.trim();
    if (!sanitizedTaskId || sanitizedTaskId.includes(path.sep) || sanitizedTaskId.includes('..')) {
        throw Object.assign(new Error('非法的 taskId'), {code: 'EINVAL'});
    }
    const fileName = `orders-${sanitizedTaskId}.json`;
    const filePath = path.join(ORDERS_DIR, fileName);
    const [content, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath)
    ]);
    const parsed = content ? JSON.parse(content) : {};
    const rawOrders = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.orders) ? parsed.orders : []);
    const orders = rawOrders.map(normalizeOrder).filter(Boolean);
    return {
        taskId: sanitizedTaskId,
        file: fileName,
        orders,
        savedAt: stats.mtime ? stats.mtime.toISOString() : null
    };
}

async function readAllOrders() {
    const files = await listOrderFiles();
    if (!files.length) {
        return [];
    }
    const tasks = await Promise.all(files.map(async fileName => {
        const match = fileName.match(ORDER_FILE_REGEX);
        const taskId = match ? match[1] : null;
        if (!taskId) {
            return null;
        }
        try {
            return await readOrdersForTask(taskId);
        } catch (err) {
            if (err && err.code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }));
    return tasks.filter(Boolean);
}

function handleReadError(res, err) {
    if (err && err.code === 'ENOENT') {
        res.status(404).json({error: '未找到批次数据'});
        return;
    }
    console.error('读取批次数据失败:', err);
    res.status(500).json({error: '服务器内部错误'});
}

function createFieldEndpoint(pathSuffix, stageName) {
    app.get(`/api/data/${pathSuffix}`, async (req, res) => {
        try {
            const batch = await loadBatch();
            const {cycle, cycleKey, cycleList} = resolveCycle(batch, req.query.cycle);
            if (!cycle) {
                res.status(404).json({error: '未找到批次数据'});
                return;
            }
            const stage = extractStage(cycle, stageName);
            const cycleHours = cycle.cycleHours;
            const cycleDays = cycle.cycleDays ?? (cycleHours / 24);
            res.json({
                stage: stageName,
                batchTimestamp: batch.timestamp,
                savedAt: stage.savedAt,
                data: stage.data,
                cycleKey,
                cycleHours,
                cycleDays,
                cycles: cycleList
            });
        } catch (err) {
            handleReadError(res, err);
        }
    });
}

app.get('/api/data', async (req, res) => {
    try {
        const batch = await loadBatch();
        const {cycle, cycleKey, cycleList} = resolveCycle(batch, req.query.cycle);
        if (!cycle) {
            res.status(404).json({error: '未找到批次数据'});
            return;
        }
        const cycleHours = cycle.cycleHours;
        const cycleDays = cycle.cycleDays ?? (cycleHours / 24);
        const stageSummary = STAGE_KEYS.map(stageName => {
            const stage = extractStage(cycle, stageName);
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
            savedAt: cycle.lastSavedAt ?? batch.lastSavedAt ?? null,
            cycleKey,
            cycleHours,
            cycleDays,
            defaultCycleKey: batch.defaultCycleKey ?? cycleKey,
            defaultCycleHours: batch.defaultCycleHours ?? cycleHours,
            stageSummary,
            cycles: cycleList
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
    const {taskId} = req.query;
    try {
        if (typeof taskId === 'string' && taskId.trim()) {
            const result = await readOrdersForTask(taskId.trim());
            res.json({
                message: '订单列表',
                taskId: result.taskId,
                count: result.orders.length,
                savedAt: result.savedAt,
                orders: result.orders
            });
            return;
        }

        const results = await readAllOrders();
        if (!results.length) {
            res.status(404).json({error: '未找到订单数据'});
            return;
        }
        const orders = results.flatMap(entry => entry.orders);
        const latestSavedAt = results
            .map(entry => entry.savedAt)
            .filter(Boolean)
            .sort()
            .pop() ?? null;
        res.json({
            message: '订单列表',
            count: orders.length,
            savedAt: latestSavedAt,
            orders,
            tasks: results.map(entry => ({
                taskId: entry.taskId,
                count: entry.orders.length,
                savedAt: entry.savedAt
            }))
        });
    } catch (err) {
        if (err && err.code === 'EINVAL') {
            res.status(400).json({error: err.message || '非法的 taskId'});
            return;
        }
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
