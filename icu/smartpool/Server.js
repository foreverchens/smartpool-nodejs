import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';
import {readLatestBatch} from './common/db.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIEW_DIR = path.join(__dirname, 'view');
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

app.get('/', (req, res, next) => {
    res.sendFile(path.join(VIEW_DIR, 'home.html'), err => {
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
    console.log(`Express server listening on http://localhost:${PORT}`);
});
