import config from "./common/Config.js";
import czClient from "./service/CzClient.js";
import Piscina from "piscina";
import path from "path";
import fs from "fs";

const threadPool = new Piscina({
    filename: path.resolve('./service/worker.js'), maxThreads: config.MAX_THREADS
});
const DATA_DIR = path.resolve('./data');
const DATA_FILE = path.join(DATA_DIR, 'latest.json');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let symbolBatchLength = 2;
let nextTimer = null;

async function persistBatch(batch) {
    try {
        await fs.promises.mkdir(DATA_DIR, {recursive: true});
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(batch, null, 2), 'utf-8');
    } catch (err) {
        console.error('写入批次数据失败:', err);
    }
}

async function run() {
    const batchTimestamp = new Date().toISOString();
    const batchPayload = {
        timestamp: batchTimestamp,
        cycleHours: config.CYCLE,
        cycleDays: +(config.CYCLE / 24).toFixed(2)
    };

    const saveStage = async (stageName, value) => {
        const savedAt = new Date().toISOString();
        const snapshot = value === undefined ? null : JSON.parse(JSON.stringify(value));
        batchPayload[stageName] = {savedAt, data: snapshot};
        batchPayload.lastStage = stageName;
        batchPayload.lastSavedAt = savedAt;
        await persistBatch(batchPayload);
    };

    let hasMore = false;
    let totalSymbols = 0;
    let symbolList = [];

    try {
        const fullSymbolList = await czClient.listSymbol();
        totalSymbols = fullSymbolList.length;

        if (!totalSymbols) {
            console.warn('未获取到币对列表，等待下一轮重试');
            await saveStage('symbolList', []);
            hasMore = true;
        } else {
            const sliceLen = Math.min(symbolBatchLength, totalSymbols);
            symbolList = fullSymbolList.slice(0, sliceLen);
            hasMore = sliceLen < totalSymbols;
            await saveStage('symbolList', symbolList);
            console.log('[symbolList] 本轮处理', sliceLen, '/', totalSymbols, '目标批次数量:', symbolBatchLength);
        }

        if (!symbolList.length) {
            if (!hasMore) {
                hasMore = true;
            }
            return;
        }

        // symbolList = ['BTCUSDT','ETHUSDT','LTCUSDT','XRPUSDT'];
        console.log(symbolList);
        let st = Date.now();
        let rltArr = await Promise.all(symbolList.map((symbol, idx) => {
            return threadPool.run([symbol, idx, symbolList.length]);
        }));
        await saveStage('rltArr', rltArr);
        let et = Date.now();
        console.log('耗时: %s秒', (et - st) / 1000);
        console.log("----------BTC锚定币币对原始分析数据----------");
        console.table(rltArr);
        console.log("----------BTC锚定币币对原始分析数据----------");

        /**
         *  简单过滤
         *  对btc汇率位置低于-0.1、弱势、反弹可能弱
         *  对btc汇率位置高于1.1、强势、回调可能弱
         *  [-0.1,1.1]内震荡最佳
         */
        let filtered = rltArr.filter(ele => ele && ele.score > 5000 && ele.symbol && ele.symbol.endsWith('BTC'));
        let centerList = filtered.filter(ele => ele.pricePosit > -0.1 && ele.pricePosit < 1.1)
            .sort((a, b) => b.pricePosit - a.pricePosit);
        await saveStage('centerList', centerList);

        console.log("----------对得分和价格位置过滤后数据----------");
        console.table(centerList);
        console.log("----------对得分和价格位置过滤后数据----------");

        let len = centerList.length;
        /**
         * 将处于震荡的币分为高低两组、[0.8,1.1]为高位组、[-0.1,0.2]为低位组、以低位组为base做多、高位组为quota做空、势能最大
         */
        let highCandidates = centerList.slice(0, len * 0.5)
            .sort((a, b) => b.score - a.score);
        let lowCandidates = centerList
            .slice(len * -0.5)
            .sort((a, b) => b.score - a.score);

        console.log("----------价格高位组数据----------");
        console.table(highCandidates);
        console.log("----------价格高位组数据----------");
        console.log("----------价格低位组数据----------");
        console.table(lowCandidates);
        console.log("----------价格低位组数据----------");

        const topHighList = highCandidates.slice(0, highCandidates.length > 5 ? 5 : highCandidates.length);
        const topLowList = lowCandidates.slice(0, lowCandidates.length > 5 ? 5 : lowCandidates.length);
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
        await saveStage('highLowList', highLowList);
        console.log("----------双币币对列表----------");
        console.table(highLowList);
        console.log("----------双币币对列表----------");

        let pairResults = await Promise.all(highLowList.map((symbol, idx) => {
            return threadPool.run([symbol, idx, highLowList.length]);
        }));
        let data = pairResults.sort((a, b) => b.score - a.score);
        await saveStage('data', data);
        console.log("----------双币币对分析数据----------");
        console.table(data);
        console.log("----------双币币对分析数据----------");
        fs.writeFileSync('./other/outlog/smartpool.json', JSON.stringify(data));
    } catch (err) {
        console.error('运行批次失败:', err);
        hasMore = true;
    } finally {
        if (totalSymbols > 0) {
            if (hasMore) {
                symbolBatchLength = Math.min(symbolBatchLength + 2, totalSymbols);
            } else {
                symbolBatchLength = totalSymbols;
            }
        }
        const delay = hasMore ? MINUTE : HOUR;
        if (nextTimer) {
            clearTimeout(nextTimer);
        }
        nextTimer = setTimeout(run, delay);
        console.log(`[调度] 下一轮将在 ${delay / 1000} 秒后执行，目标批次数量: ${symbolBatchLength}${totalSymbols ? `/${totalSymbols}` : ''}`);
    }
}

await run();
