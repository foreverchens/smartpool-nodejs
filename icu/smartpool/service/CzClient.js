import axios from "axios";
import util from "util";
import crypto from "crypto";
import config from "../common/Config.js";
import models from "../common/Models.js";

class CzClient {

    CACHE = {
        'BTC': {}, 'ETH': {}, 'BNB': {}
    }

    exSet = ['BTCUSDT', "TUSDUSDT", "USDCUSDT", "USDPUSDT", "EURUSDT", "AEURUSDT", "MANTAUSDT", "PAXGUSDT", "FDUSDUSDT", "WBETHETH", "WBTCBTC"]

    async listSymbol() {
        return await this.listContractWithBtc();
    }

    async listKline(obj) {
        let symbol = obj.symbol.toUpperCase();
        if (!symbol.endsWith('USDT')) {
            let [base, quota] = symbol.split('-');
            obj.symbol = base.concat('USDT');
            let baseKlines = await this.listKline(obj);
            obj.symbol = quota.concat('USDT');
            let hashCode = this.hashCode(obj);
            let quotaKlines;
            let quotaCache = this.CACHE[quota];
            if (quotaCache) {
                let cacheVal = quotaCache[hashCode];
                if (cacheVal) {
                    quotaKlines = cacheVal
                } else {
                    quotaKlines = await this.listKline(obj);
                    quotaCache[hashCode] = quotaKlines;
                }
            } else {
                quotaKlines = await this.listKline(obj);
            }
            if (baseKlines.length !== quotaKlines.length) {
                console.error('长度不一')
                return
            }
            for (let i = 0; i < baseKlines.length; i++) {
                if (baseKlines[i].openT !== quotaKlines[i].openT) {
                    console.error('时间不一')
                    return
                }
            }
            // 合并k线
            return baseKlines.map((baseKline, idx) => {
                let quotaKline = quotaKlines[idx];
                if (!baseKline.openP || !baseKline.highP || !baseKline.lowP || !baseKline.closeP || !quotaKline.openP || !quotaKline.highP || !quotaKline.lowP || !quotaKline.closeP) {
                    console.log(baseKline);
                }
                return models.kline(baseKline.openT, (baseKline.openP / quotaKline.openP).toPrecision(4), (baseKline.highP / quotaKline.highP).toPrecision(4), (baseKline.lowP / quotaKline.lowP).toPrecision(4), (baseKline.closeP / quotaKline.closeP).toPrecision(4))
            })
        }
        let interval = obj.period ? obj.period : '1m';
        let url = util.format("%s?symbol=%s&interval=%s&limit=%s", config.getKlineUrl(symbol), symbol, interval, obj.limit);
        if (obj.startTime) {
            url = url.concat('&startTime=' + obj.startTime);
        }
        if (obj.endTime) {
            url = url.concat('&endTime=' + obj.endTime);
        }
        return (await axios.get(url, {})).data.map(function (ele) {
            return models.kline(ele[0], ele[1], ele[2], ele[3], ele[4]);
        });
    }

    async getPrice(symbol) {
        if (!symbol.endsWith('USDT')) {
            let [base, quota] = symbol.split('-');
            let baseP = await this.getPrice(base.concat('USDT'));
            let quotaP = await this.getPrice(quota.concat('USDT'));
            return Number(baseP) / Number(quotaP);
        }
        let resp = symbol && symbol.endsWith('USDT') ? await axios.get('https://fapi.binance.com/fapi/v2/ticker/price?symbol=' + symbol, {}) : await axios.get('https://api.binance.com/api/v1/ticker/price?symbol=' + symbol, {});
        return resp.data.price;
    }

    hashCode(obj) {
        const str = JSON.stringify(obj, Object.keys(obj).sort());
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    async listContractWithBtc() {
        // 获取交易量数据
        let volList = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {});
        volList = volList.data.reduce((acc, item) => {
            acc[item.symbol] = item.quoteVolume;
            return acc;
        }, {});

        let contractList = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
        return contractList.data.symbols
            // 非USDT币对、非数字货币币对
            .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status && !this.exSet.includes(ele.symbol))
            // 新上市合约币对剔除
            .slice(0, -20)
            .filter(ele => {
                // 过滤掉交易量小于50M的合约币对
                let vol = volList[ele.symbol];
                return Number(vol) > 5000_0000;
            })
            .map(ele => ele.symbol.replace('USDT', '-BTC'))

    }
}

export default new CzClient();






