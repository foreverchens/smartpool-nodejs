const axios = require('axios');
const util = require('util');
const models = require('../common/Models')
const config = require("../common/Config")


class CzClient {

    // 现货市场时设置、BTC/ETHなど
    QUOTA_ASSERT = ['BTC', 'ETH', 'BNB'];

    exSet = ["TUSDUSDT", "USDCUSDT", "USDPUSDT", "EURUSDT", "AEURUSDT", "MANTAUSDT", "PAXGUSDT", "FDUSDUSDT", "WBETHETH", "WBTCBTC"]

    symbolList;

    async listSymbol() {
        if (this.symbolList) {
            return this.symbolList;
        }
        // 获取合约USDT币对&现货BTC&ETH币对
        let contractList = [];
        contractList = await this.listContract();
        // 现 货
        let spotList = await this.listSpot();
        return this.symbolList = contractList.concat(spotList);
    }

    async listSpot() {
        let spotList = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {});
        spotList = spotList.data.symbols
            // BTC｜ETH币对
            .filter(ele => this.QUOTA_ASSERT.includes(ele.quoteAsset) && "TRADING" === ele.status && !this.exSet.includes(ele.symbol))
            .map(ele => ele.symbol)
        // 过滤掉交易量小于5M的现货币对
        let vols = await Promise.all(spotList.map(async symbol => {
            symbol = symbol.endsWith('BTC') ? symbol.replace('BTC', 'USDT')
                : symbol.endsWith('ETH') ? symbol.replace('ETH', 'USDT') : symbol.endsWith('BNB') ? symbol.replace('BNB', 'USDT') : symbol;
            let rlt = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=' + symbol, {});
            return rlt.data.quoteVolume;
        }))

        // 交易量大于300w 平均交易量10M、因交易量过低过滤掉约55%
        return spotList.filter((_, i) => vols[i] > 10000000);
    }

    async listContract(contractList) {
        contractList = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
        contractList = contractList.data.symbols
            // 非USDT币对、非数字货币币对
            .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status && !this.exSet.includes(ele.symbol))
            // 新上市合约币对剔除
            .slice(0, -20)
            .map(ele => ele.symbol)
        // 过滤掉交易量小于10M的合约币对
        let vols = await Promise.all(contractList.map(async symbol => {
            let rlt = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + symbol, {});
            return rlt.data.quoteVolume;
        }))
        // 交易量大于1000w、平均交易量50M左右、因交易量过低过滤掉约55%
        return contractList.filter((_, i) => vols[i] > 50000000);
    }

    async listKline(obj) {
        let url = util.format("%s?symbol=%s&interval=1m&limit=%s&startTime=%s&endTime=%s", config.getKlineUrl(obj.symbol), obj.symbol, obj.limit, obj.startTime, obj.endTime);
        return (await axios.get(url, {})).data.map(function (ele) {
            return models.kline(ele[0], ele[1], ele[2], ele[3], ele[4]);
        });
    }
}
new CzClient().listSymbol()
module.exports = new CzClient();





