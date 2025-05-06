class Config {

    KLINE_CONTRACT_URL = "https://fapi.binance.com/fapi/v1/klines"

    KLINE_SPOT_URL = "https://api.binance.com/api/v3/klines"


    // 最大周期、天计
    MAX_DAY = 7;

    // 量化周期、小时计
    CYCLE = 24 * 7;
    // 3 13/56
    // 7 20/56
    // 价格的最小精度
    SCALE = 0.0001

    // 线程池大小
    MAX_THREADS = 1;

    getKlineUrl(symbol) {
        return symbol.endsWith('USDT') ? this.KLINE_CONTRACT_URL : this.KLINE_SPOT_URL;
    };
}

module.exports = new Config();