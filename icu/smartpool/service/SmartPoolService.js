import czClient from "./CzClient.js";
import config from "../common/Config.js"
import Queue from "../common/CircularQueue.js"
import models from "../common/Models.js"

class SmartPoolService {
    constructor() {
        this.HOUR_MS = 1000 * 60 * 60;
        this.KLINE_CACHE = new Map();
    }

    async analyze(symbol, hours) {
        await this.updateH1Kline(symbol);
        let h1KlineList = this.KLINE_CACHE.get(symbol).slice(hours);
        if (h1KlineList.length === 0) {
            // 新币对
            return {}
        }
        let minP = Math.min(...h1KlineList.map(e => e.lowP));
        let maxP = Math.max(...h1KlineList.map(e => e.highP));
        // 基于最低价格获取价格精度、
        let arrScale = minP * config.SCALE;
        let len = Math.trunc((maxP - minP) / arrScale);
        let dataArr = new Array(len).fill(0.0);
        // 过去24h的震荡状态 涨为1 跌为0
        let stateArr = new Array(24).fill(0);
        for (let i = 0; i < h1KlineList.length; i++) {
            let h1Kline = h1KlineList[i];
            let h1DataArr = h1Kline.dataArr;
            let lowP = h1Kline.lowP;
            // 一直涨或一直跌都会增加count count越大权重越低
            stateArr[i % 24] = h1Kline.rise ? 1 : 0;
            let weightRate = 1;
            if (i >= 3) {
                // 至少拥有4根k线状态才开始分析
                weightRate = this.getWeightRate(Math.min(i, 24), stateArr);
                if (isNaN(weightRate)) {
                    weightRate = this.getWeightRate(Math.min(i, 24), stateArr);
                    continue;
                }
            }
            let startIndex = Math.trunc((lowP - minP) / arrScale);
            for (let i = 0; i < h1DataArr.length; i++) {
                if (isNaN(h1DataArr[i])) {
                    continue
                }
                dataArr[startIndex + i] += (h1DataArr[i] * weightRate);
            }
        }
        // 总点数
        let countPt = dataArr.reduce((rlt, cur) => rlt + cur, 0.0);
        // 从左从右向中间依次去除稀疏点、将剩余的80%区间、定为震荡区间、
        let subCountPt = countPt * 0.2;
        let l = 0, r = dataArr.length - 1;
        while (subCountPt > 0) {
            while (dataArr[l] < 1.0) {
                l++;
            }
            subCountPt -= dataArr[l++];
            if (subCountPt < 1.0) {
                break;
            }
            while (dataArr[r] < 1.0) {
                r--;
            }
            subCountPt -= dataArr[r--];
        }
        // 震荡区间下沿、上沿、振幅、震荡得分｜点位密度=总点数/振幅、因最小价格精度一致、所以处于同一坐标系
        let lowP = +minP + (arrScale * l);
        let highP = +minP + (arrScale * r)
        let amplitude = +((highP - lowP) * 100 / lowP).toFixed(1);
        let score = countPt * 0.8 / amplitude;
        let price = await czClient.getPrice(symbol);
        let pricePosition = +((price - lowP) / (highP - lowP)).toFixed(2);
        return models.ShakeScore(symbol, Math.round(score), amplitude, lowP.toPrecision(4), highP.toPrecision(4), pricePosition);
    }

    /**
     * 填充或更新k线
     */
    async updateH1Kline(symbol) {
        let queue = this.KLINE_CACHE.get(symbol) || new Queue(config.MAX_DAY * 24);
        this.KLINE_CACHE.set(symbol, queue);

        // 时间处理、保留到小时级别精度、填充k线队列时、找到最远k线的开盘时间
        const lastTime = Math.floor(Date.now() / this.HOUR_MS) * this.HOUR_MS;
        let startTime = queue.isEmpty() ? lastTime - config.CYCLE * this.HOUR_MS : queue.peek().openT + this.HOUR_MS;
        if ('BTCUSDT' === symbol) {
            console.log('curTime:%s\n总更新区间: %s --> %s', new Date().toLocaleString(), new Date(startTime).toLocaleString(), new Date(lastTime).toLocaleString())
        }
        //kpi单次限制1000根、16 * 60 < 1000
        let maxHours = 16;
        while (lastTime - startTime >= this.HOUR_MS) {
            let gapHours = (lastTime - startTime) / this.HOUR_MS;
            let curHours = gapHours > maxHours ? maxHours : gapHours;
            const klines = await czClient.listKline(models.klineParam(symbol, 60 * curHours, startTime, startTime + this.HOUR_MS * curHours));
            if (klines.length === 0) {
                break
            }
            if ('BTCUSDT' === symbol) {
                console.log('更新区间: %s --> %s', new Date(klines[0].openT).toLocaleString(), new Date(klines[klines.length - 1].openT).toLocaleString())
            }
            for (let i = 0; i < klines.length; i += 60) {
                let newH1Kline = this.klineListToH1Kline(klines.slice(i, Math.min(i + 60, klines.length)));
                newH1Kline.openT = startTime;
                startTime += this.HOUR_MS;
                queue.push(newH1Kline);
            }
        }
        if ('BTCUSDT' === symbol) {
            let arr = queue.slice(config.CYCLE);
            console.log('量化区间: %s --> %s,%s个小时', new Date(arr[0].openT).toLocaleString(), new Date(arr[arr.length - 1].openT + this.HOUR_MS).toLocaleString(), arr.length)
        }
    }

    klineListToH1Kline(klines) {
        let lowP = Math.min(...klines.map(e => e.lowP));
        let highP = Math.max(...klines.map(e => e.highP));
        let arrScale = lowP * config.SCALE;
        let dataArr = new Array(Math.trunc((highP - lowP) / arrScale)).fill(0);
        for (let i = 0; i < klines.length; i++) {
            let kline = klines[i];
            let openP = kline.openP;
            let closeP = kline.closeP;
            if (openP > closeP) {
                //  开盘价高于收盘价、即下跌、交换数值使closeP大于openP、方便计算
                let tmp = closeP;
                closeP = openP;
                openP = tmp;
            }
            if (closeP - openP < arrScale) {
                // 低波动k线过滤
                continue;
            }

            let startIndex = Math.trunc((openP - lowP) / arrScale);
            let endIndex = Math.trunc((closeP - lowP) / arrScale);
            while (startIndex < endIndex && startIndex < dataArr.length) {
                dataArr[startIndex++]++;
            }
        }
        for (let ele of dataArr) {
            if (isNaN(ele)) {
                continue;
            }
        }
        let rise = klines[klines.length - 1].closeP > klines[0].openP
        return models.H1Kline(null, lowP, highP, dataArr, rise);
    }


    /**
     *
     * @param len  数组的统计长度
     * @param stateArr  状态数组 长度24 涨为1 跌为0
     * @returns {number}
     */
    getWeightRate(len, stateArr) {
        const count = stateArr
            .slice(0, len)
            .reduce((sum, v) => sum + v, 0);
        const table = [1.000, 0.994, 0.975, 0.944, 0.901, 0.846, 0.778, 0.698, 0.605, 0.500];
        const half = len / 2;
        const rawRate = Math.round(Math.abs((half - count) * 10 / half));
        // 前面满1或满0的情况
        const idx = rawRate === table.length ? table.length - 1 : rawRate;
        return table[idx];
    }
}

export default new SmartPoolService();
