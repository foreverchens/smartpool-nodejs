const axios = require('axios');
const tunnel = require("tunnel");
const util = require('util');
const models = require('../common/Models')
const config = require("../common/Config")

let axiosConfig = {
    proxy: false, httpsAgent: tunnel.httpsOverHttp({proxy: {host: '127.0.0.1', port: '7890'}}),
}

class CzClient {

    async listSymbol() {
        let data = await axios.get(config.LIST_SYMBOL_URL, axiosConfig);
        const set = ["TUSDUSDT", "USDCUSDT", "USDPUSDT", "EURUSDT", "AEURUSDT", "MANTAUSDT", "PAXGUSDT","FDUSDUSDT"]
        return data.data.symbols
            .filter(ele => "USDT" === ele.quoteAsset && "TRADING" === ele.status && !set.includes(ele.symbol))
            .map(ele => ele.symbol);
    }

    async listKline(obj) {
        let url = util.format("%s?symbol=%s&interval=1m&limit=%s&startTime=%s&endTime=%s", config.KLINE_URL, obj.symbol, obj.limit, obj.startTime, obj.endTime);
        return (await axios.get(url, axiosConfig)).data.map(function (ele) {
            return models.kline(ele[0], ele[1], ele[2], ele[3], ele[4]);
        });
    }
}

module.exports = new CzClient();





