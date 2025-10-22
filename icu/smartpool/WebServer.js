import express from 'express';
import {readdir, readFile} from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';
import {readLatestBatch} from './service/SmartPoolMapper.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIEW_DIR = path.join(__dirname, 'view');
const GRID_DATA_DIR = path.join(__dirname, 'grid', 'data');
const STAGE_KEYS = ['symbolList', 'rltArr', 'centerList', 'highList', 'lowList', 'highLowList', 'data'];
const ORDER_FILE_PREFIX = 'orders-';
const ORDER_FILE_SUFFIX = '.json';

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

function handleReadError(res, err) {
    if (err && err.code === 'ENOENT') {
        res.status(404).json({error: '未找到批次数据'});
        return;
    }
    console.error('读取批次数据失败:', err);
    res.status(500).json({error: '服务器内部错误'});
}

function normalizeTaskId(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
}

async function loadOrderFiles(taskId) {
    let dirEntries;
    try {
        dirEntries = await readdir(GRID_DATA_DIR, {withFileTypes: true});
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return {orders: [], sources: []};
        }
        throw err;
    }

    const orderEntries = dirEntries.filter(entry => entry.isFile()
        && entry.name.startsWith(ORDER_FILE_PREFIX)
        && entry.name.endsWith(ORDER_FILE_SUFFIX));
    if (!orderEntries.length) {
        return {orders: [], sources: []};
    }

    const normalizedTaskId = normalizeTaskId(taskId);
    let selectedEntries = orderEntries;
    if (normalizedTaskId) {
        const expectedName = `${ORDER_FILE_PREFIX}${normalizedTaskId}${ORDER_FILE_SUFFIX}`;
        const exact = orderEntries.find(entry => entry.name === expectedName);
        if (exact) {
            selectedEntries = [exact];
        }
    }

    const fileResults = await Promise.all(selectedEntries.map(async entry => {
        const filePath = path.join(GRID_DATA_DIR, entry.name);
        try {
            const raw = await readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            const orders = Array.isArray(parsed?.orders) ? parsed.orders : [];
            if (!orders.length) {
                return [];
            }
            const fallbackTaskId = entry.name.slice(ORDER_FILE_PREFIX.length, -ORDER_FILE_SUFFIX.length);
            return orders.map(order => {
                if (!order || typeof order !== 'object') {
                    return order;
                }
                if (!order.taskId && fallbackTaskId) {
                    return {...order, taskId: fallbackTaskId};
                }
                return order;
            });
        } catch (err) {
            console.error(`读取订单文件失败: ${entry.name}`, err);
            return [];
        }
    }));

    const flatOrders = fileResults.flat();
    if (!flatOrders.length) {
        return {
            orders: [],
            sources: selectedEntries.map(entry => entry.name)
        };
    }

    const filteredOrders = normalizedTaskId
        ? flatOrders.filter(order => normalizeTaskId(order?.taskId ?? order?.task_id) === normalizedTaskId)
        : flatOrders;

    const toSafeTime = value => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    };

    filteredOrders.sort((a, b) => {
        const timeA = toSafeTime(a?.updateTime);
        const timeB = toSafeTime(b?.updateTime);
        return timeA - timeB;
    });

    return {
        orders: filteredOrders,
        sources: selectedEntries.map(entry => entry.name)
    };
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

app.get('/api/orders', async (req, res) => {
    try {
        const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : '';
        const {orders, sources} = await loadOrderFiles(taskId);
        res.json({
            orders,
            taskId: normalizeTaskId(taskId) || null,
            sources
        });
    } catch (err) {
        console.error('加载订单数据失败:', err);
        res.status(500).json({error: '订单数据加载失败'});
    }
});

createFieldEndpoint('symbol-list', 'symbolList');
createFieldEndpoint('initial-results', 'rltArr');
createFieldEndpoint('center-list', 'centerList');
createFieldEndpoint('high-list', 'highList');
createFieldEndpoint('low-list', 'lowList');
createFieldEndpoint('pairs', 'highLowList');
createFieldEndpoint('final-results', 'data');

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
