const axios = require('axios');
const util = require('util');
const crypto = require('crypto');

const models = require('../common/Models')
const config = require("../common/Config")


class CzClient {

    // 现货市场时设置、BTC/ETHなど
    QUOTA_ASSERT = ['BTC'
        // , 'ETH'
        // , 'BNB'
    ];

    CACHE = {
        'BTC': {}, 'ETH': {}, 'BNB': {}
    }

    exSet = ['BTCUSDT',"TUSDUSDT", "USDCUSDT", "USDPUSDT", "EURUSDT", "AEURUSDT", "MANTAUSDT", "PAXGUSDT", "FDUSDUSDT", "WBETHETH", "WBTCBTC"]

    symbolList;

    async listSymbol() {
        if (this.symbolList) {
            return this.symbolList;
        }
        // 获取合约USDT币对&现货BTC&ETH币对
        let contractList = [];
        // USDT合约
        // contractList = await this.listContract();
        // 现 货
        let spotList = [];
        // spotList = await this.listSpot();
        // 合约币对但BTC
        let contractWithBtcList = [];
        contractWithBtcList = await this.listContractWithBtc();
        return this.symbolList = contractList.concat(spotList).concat(contractWithBtcList);
    }

    async listSpot() {
        let volList = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {});
        volList = volList.data.reduce((acc, item) => {
            acc[item.symbol] = item.quoteVolume;
            return acc;
        }, {});

        let spotList = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {});
        return spotList.data.symbols
            // BTC｜ETH币对
            .filter(ele => this.QUOTA_ASSERT.includes(ele.quoteAsset) && "TRADING" === ele.status && !this.exSet.includes(ele.symbol))
            .map(ele => ele.symbol)
            .filter(symbol => {
                // 过滤掉交易量小于5M的现货币对
                // 交易量大于300w 平均交易量10M、因交易量过低过滤掉约55%
                symbol = symbol.endsWith('BTC') ? symbol.replace('BTC', 'USDT') : symbol.endsWith('ETH') ? symbol.replace('ETH', 'USDT') : symbol.endsWith('BNB') ? symbol.replace('BNB', 'USDT') : symbol;
                let vol = volList[symbol];
                return Number(vol) > 20000000;
            })
    }

    async listContract(contractList) {
        let volList = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {});
        volList = volList.data.reduce((acc, item) => {
            acc[item.symbol] = item.quoteVolume;
            return acc;
        }, {});

        contractList = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
        return contractList.data.symbols
            // 非USDT币对、非数字货币币对
            .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status && !this.exSet.includes(ele.symbol))
            // 新上市合约币对剔除
            .slice(0, -20)
            .map(ele => ele.symbol)
            .filter(symbol => {
                // 过滤掉交易量小于10M的合约币对
                // 交易量大于1000w、平均交易量50M左右、因交易量过低过滤掉约55%
                let vol = volList[symbol];
                return Number(vol) > 5000_0000;
            })
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
                // 过滤掉交易量小于10M的合约币对
                // 交易量大于1000w、平均交易量50M左右、因交易量过低过滤掉约55%
                let vol = volList[ele.symbol];
                return Number(vol) > 5000_0000;
            })
            .map(ele => ele.symbol.replace('USDT','-BTC'))

    }
}

module.exports = new CzClient();





