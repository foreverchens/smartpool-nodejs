
class Config {
    LIST_SYMBOL_URL = "https://api.binance.com/api/v3/exchangeInfo";

    KLINE_URL = "https://api.binance.com/api/v3/klines"

    MAX_DAY = 1;

    CYCLE = 24;

    SCALE = 0.0001
}

module.exports = new Config();