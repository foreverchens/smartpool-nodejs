import path from "path";
import Piscina from "piscina";
import config from "./common/Config.js";
import czClient from "./service/CzClient.js";
import {writeLatestBatch} from "./service/SmartPoolMapper.js";

const threadPool = new Piscina({
    filename: path.resolve('./service/worker.js'), maxThreads: config.MAX_THREADS
});
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let symbolBatchLength = 20;
let nextTimer = null;
// 记录各周期上一次高分币对，减少波动
const prevHighScorePairs = new Map();
// 配置声明的全部量化周期
const cycles = config.CYCLE;
// 默认周期用于 UI 展示与回退
const defaultCycleHours = cycles[0];
const defaultCycleKey = String(defaultCycleHours);

async function persistBatch(batch) {
    try {
        await writeLatestBatch(batch);
    } catch (err) {
        console.error('写入批次数据失败:', err);
    }
}

// 单个周期的核心流程：拉取数据 → 量化 → 持久化
async function runCycle(cycleHours, cycleKey, batchPayload) {
    const cycleData = batchPayload.cycles[cycleKey] ?? {cycleHours, cycleDays: cycleHours / 24};
    cycleData.cycleHours = cycleHours;
    cycleData.cycleDays = cycleHours / 24;
    batchPayload.cycles[cycleKey] = cycleData;

    let hasMore = false;
    let totalSymbols = 0;
    let symbolList = [];

    const saveStage = async (stageName, value) => {
        const savedAt = new Date().toISOString();
        const snapshot = value === undefined ? null : JSON.parse(JSON.stringify(value));
        cycleData[stageName] = {savedAt, data: snapshot};
        cycleData.lastStage = stageName;
        cycleData.lastSavedAt = savedAt;
        if (cycleKey === defaultCycleKey) {
            batchPayload.lastStage = stageName;
            batchPayload.lastSavedAt = savedAt;
            batchPayload.cycleHours = cycleData.cycleHours;
            batchPayload.cycleDays = cycleData.cycleDays;
        }
        await persistBatch(batchPayload);
    };

    let st = Date.now();
    try {
        const fullSymbolList = await czClient.listSymbol();
        totalSymbols = fullSymbolList.length;

        if (!totalSymbols) {
            console.warn(`[cycle ${cycleHours}] 未获取到币对列表，等待下一轮重试`);
            await saveStage('symbolList', []);
            hasMore = true;
        } else {
            const sliceLen = Math.min(symbolBatchLength, totalSymbols);
            symbolList = fullSymbolList.slice(0, sliceLen);
            hasMore = sliceLen < totalSymbols;
            await saveStage('symbolList', symbolList);
            console.log(`[cycle ${cycleHours}] [symbolList] 本轮处理`, sliceLen, '/', totalSymbols, '目标批次数量:', symbolBatchLength);
        }

        if (!symbolList.length) {
            if (!hasMore) {
                hasMore = true;
            }
            return {hasMore, totalSymbols};
        }

        console.log(`[cycle ${cycleHours}] 初始币对:`, symbolList);
        let st = Date.now();
        let rltArr = await Promise.all(symbolList.map((symbol, idx) => {
            return threadPool.run({symbol, idx, len: symbolList.length, cycleHours});
        }));
        await saveStage('rltArr', rltArr);
        let et = Date.now();
        console.log(`\n[cycle ${cycleHours}] BTC初始币对量化耗时: %s秒\n`, (et - st) / 1000);

        /**
         *  简单过滤
         *  对btc汇率位置低于-0.1、弱势、反弹可能弱
         *  对btc汇率位置高于1.1、强势、回调可能弱
         *  [-0.1,1.1]内震荡最佳
         */
        let filtered = rltArr.filter(ele => ele && ele.score > 5000 && ele.symbol && ele.symbol.endsWith('BTC'));
        let centerList = filtered.filter(ele => ele.pricePosit > -0.3 && ele.pricePosit < 1.3)
            .sort((a, b) => b.pricePosit - a.pricePosit);
        await saveStage('centerList', centerList);

        let len = centerList.length;
        /**
         * 将处于震荡的币分为高低两组、[0.8,1.1]为高位组、[-0.1,0.2]为低位组、以低位组为base做多、高位组为quota做空、势能最大
         */
        let highCandidates = centerList.slice(0, len * 0.5)
            .sort((a, b) => b.score - a.score);
        let lowCandidates = centerList
            .slice(len * -0.5)
            .sort((a, b) => b.score - a.score);

        const topHighList = highCandidates.slice(0, highCandidates.length > 10 ? 10 : highCandidates.length);
        const topLowList = lowCandidates.slice(0, lowCandidates.length > 10 ? 10 : lowCandidates.length);
        await saveStage('highList', topHighList);
        await saveStage('lowList', topLowList);

        /**
         *  两者组装为币币交易对、获取震荡指标
         */
        const lowSymbolList = topLowList.map(ele => ele.symbol.replace('-BTC', ''));
        const highSymbolList = topHighList.map(ele => ele.symbol.replace('-BTC', ''));
        let highLowList = [];
        highSymbolList.forEach(e1 => {
            lowSymbolList.forEach(e2 => {
                highLowList.push(e2 + '-' + e1);
            });
        });
        const highLowSet = new Set(highLowList);
        const prevPairs = prevHighScorePairs.get(cycleKey);
        if (prevPairs) {
            prevPairs.forEach(symbol => highLowSet.add(symbol));
        }
        highLowList = Array.from(highLowSet);
        await saveStage('highLowList', highLowList);

        st = Date.now();
        let pairResults = await Promise.all(highLowList.map((symbol, idx) => {
            return threadPool.run({symbol, idx, len: highLowList.length, cycleHours});
        }));
        et = Date.now();
        console.log(`\n[cycle ${cycleHours}] 双币初始币对量化耗时: %s秒\n`, (et - st) / 1000);
        let data = pairResults.sort((a, b) => b.score - a.score);
        await saveStage('data', data);
        console.log(`[cycle ${cycleHours}] ----------双币币对分析数据----------`);
        console.table(data.slice(0, 10));
        console.log(`[cycle ${cycleHours}] ----------双币币对分析数据----------`);

        const nextPrevPairs = new Set(pairResults
            .filter(item => item && item.symbol && item.score > 20000)
            .map(item => item.symbol));
        prevHighScorePairs.set(cycleKey, nextPrevPairs);
    } catch (err) {
        console.error(`[cycle ${cycleHours}] 运行批次失败:`, err);
        hasMore = true;
    } finally {
        console.log(`[cycle ${cycleHours}] 量化总耗时: %s秒`, (Date.now() - st) / 1000);
    }

    return {hasMore, totalSymbols};
}

async function run() {
    const batchTimestamp = new Date().toISOString();
    const batchPayload = {
        timestamp: batchTimestamp,
        cycles: {},
        defaultCycleHours,
        defaultCycleKey,
        cycleHours: defaultCycleHours,
        cycleDays: defaultCycleHours / 24
    };

    const cycleResults = [];
    for (const cycleHours of cycles) {
        const cycleKey = String(cycleHours);
        const result = await runCycle(cycleHours, cycleKey, batchPayload);
        cycleResults.push({...result, cycleKey, cycleHours});
    }

    let hasMoreAny = false;
    let lastTotalSymbols = 0;
    for (const result of cycleResults) {
        if (result.hasMore) {
            hasMoreAny = true;
        }
        if (result.totalSymbols > 0) {
            lastTotalSymbols = result.totalSymbols;
        }
    }

    if (lastTotalSymbols > 0) {
        if (hasMoreAny) {
            symbolBatchLength = Math.min(symbolBatchLength + 1, lastTotalSymbols);
        } else {
            symbolBatchLength = lastTotalSymbols;
        }
    }

    const delay = hasMoreAny ? MINUTE / 2 : HOUR;
    if (nextTimer) {
        clearTimeout(nextTimer);
    }
    nextTimer = setTimeout(run, delay);
    console.log(`[调度] 下一轮将在 ${delay / 1000} 秒后执行，目标批次数量: ${symbolBatchLength}${lastTotalSymbols ? `/${lastTotalSymbols}` : ''}`);
}

await run();
