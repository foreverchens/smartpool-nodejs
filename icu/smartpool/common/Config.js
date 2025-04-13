
class Config {
    LIST_SYMBOL_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

    KLINE_URL = "https://fapi.binance.com/fapi/v1/klines"

    // 最大周期、天计
    MAX_DAY = 7;

    // 量化周期、小时计
    CYCLE = 24 * 7;

    // 价格的最小精度
    SCALE = 0.0001

    MAX_THREADS = 2;
}

module.exports = new Config();