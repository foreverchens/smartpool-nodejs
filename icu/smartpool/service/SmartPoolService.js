import czClient from "./CzClient.js";
import config from "../common/Config.js"
import models from "../common/Models.js"
import KlineCacheManager from "./KlineCacheManager.js"

const SCALE_FACTOR = config.SCALE_MULTIPLIER;
const SCALE_PRECISION = config.SCALE;

const toScaled = (value) => Math.trunc(Number(value) * SCALE_FACTOR);
const fromScaled = (value) => value / SCALE_FACTOR;
const computeArrScale = (base) => {
    const scale = Number((BigInt(base) * BigInt(SCALE_PRECISION)) / BigInt(SCALE_FACTOR));
    return scale > 0 ? scale : 1;
};
const indexDelta = (value, base, step) => {
    if (step === 0) {
        return 0;
    }
    return Number(BigInt(value - base) / BigInt(step));
};

class SmartPoolService {
    constructor() {
        this.HOUR_MS = 1000 * 60 * 60;
        this.cacheManager = new KlineCacheManager(config.MAX_DAY * 24);
    }

    async analyze(symbol, hours) {
        const queue = await this.cacheManager.get(symbol);
        await this.updateH1Kline(symbol, queue);
        let h1KlineList = queue.slice(hours);
        if (h1KlineList.length === 0) {
            // 新币对
            return {}
        }
        let minP = Math.min(...h1KlineList.map(e => e.lowP));
        let maxP = Math.max(...h1KlineList.map(e => e.highP));
        // 基于最低价格获取价格精度、
        let arrScale = computeArrScale(minP);
        let diffP = maxP - minP;
        let len = Number(BigInt(diffP) / BigInt(arrScale)) + 1;
        len = len > 0 ? len : 1;
        let dataArr = new Array(len).fill(0);
        // 过去24h的震荡状态 涨为1 跌为0
        let stateArr = new Array(24).fill(0);
        let price24hAgo = h1KlineList[0].lowP;
        for (let i = 0; i < h1KlineList.length; i++) {
            let h1Kline = h1KlineList[i];
            let h1DataArr = h1Kline.dataArr;
            let lowP = h1Kline.lowP;
            // 一直涨或一直跌都会增加count count越大权重越低
            stateArr[i % 24] = h1Kline.rise ? 1 : 0;
            let stateWeight = 1;
            let priceWeight = 1;
            if (i >= 23) {
                // 至少拥有24根k线状态才开始分析
                // 震荡状态分布权重
                stateWeight = this.getStateWeight(stateArr);
                // 相对振幅权重
                let amp = (h1Kline.lowP - price24hAgo) / price24hAgo * 100;
                priceWeight = this.getPriceWeight(amp);
                price24hAgo = h1KlineList[i - 22].lowP;
            }
            let startIndex = indexDelta(lowP, minP, arrScale);
            for (let i = 0; i < h1DataArr.length; i++) {
                if (isNaN(h1DataArr[i])) {
                    continue
                }
                const idx = startIndex + i;
                if (idx >= dataArr.length) {
                    break;
                }
                dataArr[idx] += (h1DataArr[i] * stateWeight * priceWeight);
            }
        }
        // 总点数
        let countPt = dataArr.reduce((rlt, cur) => rlt + cur, 0.0);
        // 从左从右向中间依次去除稀疏点、将剩余的80%区间、定为震荡区间、
        let subCountPt = countPt * 0.2;
        let l = 0, r = dataArr.length - 1;
        while (subCountPt > 0 && l < dataArr.length && r >= 0) {
            while (l < dataArr.length && dataArr[l] < 1.0) {
                l++;
            }
            if (l >= dataArr.length) {
                break;
            }
            subCountPt -= dataArr[l++];
            if (subCountPt < 1.0) {
                break;
            }
            while (r >= 0 && dataArr[r] < 1.0) {
                r--;
            }
            if (r < 0) {
                break;
            }
            subCountPt -= dataArr[r--];
        }
        l = Math.min(Math.max(l, 0), dataArr.length - 1);
        r = Math.min(Math.max(r, 0), dataArr.length - 1);
        // 震荡区间下沿、上沿、振幅、震荡得分｜点位密度=总点数/振幅、因最小价格精度一致、所以处于同一坐标系
        let scaledLowP = minP + (arrScale * l);
        let scaledHighP = minP + (arrScale * r);
        if (scaledHighP < scaledLowP) {
            [scaledLowP, scaledHighP] = [scaledHighP, scaledLowP];
        }
        const amplitudeBase = scaledLowP === 0 ? 1 : scaledLowP;
        const amplitude = Number((((scaledHighP - scaledLowP) * 100) / amplitudeBase).toFixed(1));
        const score = amplitude === 0 ? 0 : (countPt * 0.8 / amplitude);
        const price = await czClient.getPrice(symbol);
        const scaledPrice = toScaled(price);
        const priceRange = scaledHighP - scaledLowP;
        const pricePosit = priceRange === 0 ? 0 : +(((scaledPrice - scaledLowP) / priceRange)).toFixed(2);
        return models.ShakeScore(symbol, Math.round(score), amplitude, fromScaled(scaledLowP).toPrecision(4), fromScaled(scaledHighP).toPrecision(4), pricePosit);
    }

    /**
     * 填充或更新k线
     */
    async updateH1Kline(symbol, queue) {
        let hasUpdate = false;
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
                hasUpdate = true;
            }
        }
        if (hasUpdate) {
            await this.cacheManager.save(symbol);
        }
        if ('BTCUSDT' === symbol) {
            let arr = queue.slice(config.CYCLE);
            console.log('量化区间: %s --> %s,%s个小时', new Date(arr[0].openT).toLocaleString(), new Date(arr[arr.length - 1].openT + this.HOUR_MS).toLocaleString(), arr.length)
        }
    }

    klineListToH1Kline(klines) {
        if (!klines || klines.length === 0) {
            return models.H1Kline(null, 0, 0, [], false);
        }
        const scaledKlines = klines.map(kline => ({
            openT: kline.openT,
            openP: toScaled(kline.openP),
            closeP: toScaled(kline.closeP),
            highP: toScaled(kline.highP),
            lowP: toScaled(kline.lowP)
        }));
        let lowP = scaledKlines.reduce((min, cur) => cur.lowP < min ? cur.lowP : min, scaledKlines[0].lowP);
        let highP = scaledKlines.reduce((max, cur) => cur.highP > max ? cur.highP : max, scaledKlines[0].highP);
        let arrScale = computeArrScale(lowP);
        let diff = highP - lowP;
        let length = Number(BigInt(diff) / BigInt(arrScale)) + 1;
        length = length > 0 ? length : 1;
        let dataArr = new Array(length).fill(0);
        for (let kline of scaledKlines) {
            let openP = kline.openP;
            let closeP = kline.closeP;
            if (openP > closeP) {
                //  开盘价高于收盘价、即下跌、交换数值使closeP大于openP、方便计算
                [openP, closeP] = [closeP, openP];
            }
            if (closeP - openP < arrScale) {
                // 低波动k线过滤
                continue;
            }

            let startIndex = indexDelta(openP, lowP, arrScale);
            let endIndex = indexDelta(closeP, lowP, arrScale);
            let idx = startIndex;
            while (idx < endIndex && idx < dataArr.length) {
                dataArr[idx++]++;
            }
        }
        let rise = scaledKlines[scaledKlines.length - 1].closeP > scaledKlines[0].openP
        return models.H1Kline(null, lowP, highP, dataArr, rise);
    }


    /**
     *
     * 当 1 的数量占据一半时 说明震荡
     * 当 1 的数量偏离一半时 说明趋势 同时保持减速下降曲线 先加速下降 后缓慢下降
     * @param stateArr  状态数组 长度24 涨为1 跌为0
     * @returns {number}
     */
    getStateWeight(stateArr) {
        const count = stateArr
            .reduce((sum, v) => sum + v, 0);
        const half = stateArr.length / 2;
        // [0,1] 当 1 的数量 由 均衡慢慢倾斜时  rawRate 从0 开始慢慢增大
        const rawRate = Math.abs((half - count) / half);
        // [0.5,1] 减速下降曲线 当 1 的数量 由 均衡慢慢倾斜时  weight 从 1 先加速下降 后缓慢下降
        const weight = 0.5 + 0.5 * Math.pow(1 - rawRate, 2);
        return parseFloat(weight.toFixed(3));
    }

    /**
     * 双山寨币 24h内的振幅
     * 3%内算佳 振幅越大 越趋于趋势
     * 使用加速下降曲线 低振幅时缓慢下降 反之加速下降
     *
     * @param amp
     * @returns {number}
     */
    getPriceWeight(amp) {
        // [0,1] 对振幅简单处理 使其值域置于[0,1]
        const rawRate = Math.min(Math.abs(amp), 10) / 10;
        // [0.5,1] 加速下降曲线 振幅越大 weight 从 1开始 先缓慢下降后加速下降
        const weight = 0.5 + 0.5 * (1 - Math.pow(rawRate, 2));
        return parseFloat(weight.toFixed(3));
    }
}

export default new SmartPoolService();
