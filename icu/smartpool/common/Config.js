class Config {

    KLINE_CONTRACT_URL = "https://fapi.binance.com/fapi/v1/klines"

    KLINE_SPOT_URL = "https://api.binance.com/api/v3/klines"

    // 最大周期、天计
    MAX_DAY = 30;
    // 量化周期、小时计
    CYCLE = [24 * 28, 24 * 14]
    // 所有价格字段统一使用的整数缩放倍率（10^9）
    SCALE_MULTIPLIER = 10_0000_0000;
    // 价格的最小精度（缩放后整数表示，等价于 0.0001）
    SCALE = 100_000;
    // 线程池大小
    MAX_THREADS = 2;

    getKlineUrl(symbol) {
        return symbol.endsWith('USDT') ? this.KLINE_CONTRACT_URL : this.KLINE_SPOT_URL;
    };
}
export default new Config();
