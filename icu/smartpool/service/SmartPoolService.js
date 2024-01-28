const czClient = require('./CzClient')
const config = require('../common/Config')
const Queue = require('../common/Queue')
const models = require('../common/Models')

class SmartPoolService {
    constructor() {
        this.HOUR = 1000 * 60 * 60;
        this.QUEUE_SIZE = config.MAX_DAY * 24;
        this.KLINE_CACHE = new Map();
    }

    async analyze(symbol, hours) {
        await this.updateH1Kline(symbol);
        let h1KlineList = this.KLINE_CACHE.get(symbol).slice(hours);
        let minP = 99999;
        let maxP = 0;
        for (let h1Kline of h1KlineList) {
            minP = minP > h1Kline.lowP ? h1Kline.lowP : minP;
            maxP = maxP < h1Kline.highP ? h1Kline.highP : maxP;
        }

        let arrScale = minP * config.SCALE;
        let len = Math.trunc((maxP - minP) / arrScale);
        let dataArr = new Array(len).fill(0);
        for (let h1Kline of h1KlineList) {
            let h1DataArr = h1Kline.dataArr;
            let lowP = h1Kline.lowP;
            let startIndex = Math.trunc((lowP - minP) / arrScale);
            for (let i = 0; i < h1DataArr.length; i++) {
                dataArr[startIndex + i] += h1DataArr[i];
            }
        }
        // 总点数
        let countPt = dataArr.reduce((rlt, cur) => rlt + cur, 0);
        // 去掉区间上下的稀疏点各10%、点位分布曲线砍去两边10%、定为震荡区间、
        let subCountPt = countPt * 0.2;
        let l = 0, r = dataArr.length - 1;
        while (subCountPt > 0) {
            while (dataArr[l] < 1) {
                l++;
            }
            subCountPt -= dataArr[l++];
            if (subCountPt < 1) {
                break;
            }
            while (dataArr[r] < 1) {
                r--;
            }
            subCountPt -= dataArr[r--];
        }
        let lowP = +minP + (arrScale * l);
        let highP = +minP + (arrScale * r)
        let amplitude = (highP - lowP) * 100 / lowP;
        let score = countPt * 0.8 / amplitude;
        return models.ShakeScore(symbol, score, amplitude, lowP, highP);
    }

    async updateH1Kline(symbol) {
        let queue = this.KLINE_CACHE.get(symbol) || new Queue(config.MAX_DAY * 24);
        const lastTime = Math.floor(Date.now() / this.HOUR) * this.HOUR;
        let startTime = queue.isEmpty()
            ? Math.floor(Date.now() / this.HOUR) * this.HOUR - this.QUEUE_SIZE * this.HOUR
            : queue.peek().openT + this.HOUR;
        for (let maxHour = 16; maxHour > 0; maxHour--) {
            while ((lastTime - startTime) / this.HOUR >= maxHour) {
                try {
                    const klines = await czClient.listKline(models.klineParam(symbol, 60 * maxHour, startTime, startTime + this.HOUR * maxHour));
                    for (let i = 0; i < klines.length; i += 60) {
                        let klines1 = klines.slice(i, Math.min(i + 60, klines.length));
                        let newH1Kline = this.klineListToH1Kline(klines1);
                        newH1Kline.openT = startTime += this.HOUR;
                        queue.push(newH1Kline);
                    }
                } catch (error) {
                    console.error('Error fetching Kline data:', error.message);
                }
            }
        }
        this.KLINE_CACHE.set(symbol, queue);
    }

    klineListToH1Kline(klines) {
        let lowP = 99999;
        let highP = 0;
        for (let kline of klines) {
            lowP = lowP > kline.lowP ? kline.lowP : lowP;
            highP = highP < kline.highP ? kline.highP : highP;
        }

        let arrScale = lowP * config.SCALE;
        let dataArr = new Array(Math.trunc((highP - lowP) / arrScale)).fill(0);
        for (let kline of klines) {
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
            while (startIndex < endIndex) {
                dataArr[startIndex++]++;
            }
        }
        return models.H1Kline(null, lowP, highP, dataArr);
    }
}


module.exports = new SmartPoolService();
