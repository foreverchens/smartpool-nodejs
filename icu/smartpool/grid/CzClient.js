import Binance from "node-binance-api";
import axios from "axios";
import crypto from "crypto";

const APIKEY = 'qbc5djgYcospWpt5RNwBUgVesnzAP0jj68ZXeciXuBSRQGPVbExQomZKjYenuZ1Q';
const APISECRET = '40pOBNmUndKuGY33nqNi8SMMuC3GsWTA8aRP7rb4fHZDpUE4CDEKhVKoSFkqqTqx';
const client = new Binance({
    APIKEY: APIKEY, APISECRET: APISECRET,
})

class CzClient {
    /**
     * 获取现货账户余额
     * @returns {Promise<Object>} { balances: [{ asset, free, locked }] }
     */
    async getSpotAccount() {
        const info = await client.account();
        const balances = info.balances
            .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map(b => ({asset: b.asset, free: b.free, locked: b.locked}));
        return balances;
    }

    /**
     * 获取合约账户余额 没用
     * @returns {Promise<Object>} { assets: [{ asset, walletBalance, unrealizedProfit, marginBalance }] }
     */
    async getFuturesAccount() {
        const rlt = await client.futuresAccount();
        return rlt.assets
            .filter(a => parseFloat(a.walletBalance) !== 0 || parseFloat(a.positionInitialMargin) !== 0)
            .map(a => ({
                asset: a.asset,
                walletBalance: a.walletBalance,
                unrealizedProfit: a.unrealizedProfit,
                marginBalance: a.marginBalance
            }));
    }

    /**
     * 获取合约账户保证金余额
     */
    async getFuturesBalance() {
        let rlt = await client.futuresBalance();
        return rlt.filter(a => parseFloat(a.balance) !== 0)
            .map(a => ({
                asset: a.asset, walletBalance: a.balance
            }));
    }

    async futureBuy(symbol, qty, price) {
        return await client.futuresBuy(symbol, qty, price, {'timeInForce': 'GTC'});
    }

    async futureSell(symbol, qty, price) {
        return await client.futuresSell(symbol, qty, price, {'timeInForce': 'GTC'});
    }

    /**
     * 批量下单
     */
    async futureMultiOrder(orders) {
        return await client.futuresMultipleOrders(orders);
    }

    /**
     * 获取合约持仓核心数据
     * @returns {Promise<Array>} [{ symbol, positionAmt, entryPrice, unrealizedProfit, leverage }]
     */
    async getFuturesPositionRisk(symbol = '') {
        const positions = await client.futuresPositionRisk();
        let rlt = positions
            .filter(p => parseFloat(p.positionAmt) !== 0)
            .map(p => ({
                symbol: p.symbol,
                positionAmt: p.positionAmt,
                entryPrice: p.entryPrice,
                markPrice: p.markPrice,
                unrealizedProfit: p.unRealizedProfit,
                notional: p.notional
            }));
        if (symbol) {
            for (let ele of rlt) {
                if (ele.symbol === symbol) {
                    return [ele];
                }
            }
        }
        return rlt;
    }

    /**
     * 获取合约最新价格
     * 不传参时获取全部价格
     * @param {string} symbol
     */
    async getFuturesPrice(symbol) {
        let rlt = await client.futuresPrices(symbol);
        return Number(rlt[symbol]);
    }

    /**
     * 获取最新订单簿价格
     */
    async getFuturesBookTicker(symbol) {
        let rlt = await client.futuresBookTicker(symbol);
        return rlt[symbol];
    }

    /**
     * 下合约订单
     *
     let options = {
     'symbol': 'SOLUSDT',
     'side': 'BUY',
     'type': 'LIMIT',
     'quantity': '1',
     'price': '100',
     'reduceOnly': 'false',
     'timeInForce': 'GTC'
     }
     *
     * @param {Object} options
     * @param {string} options.symbol     合约交易对（如 'ETHUSDT'）
     * @param {'BUY'|'SELL'} options.side  买/卖
     * @param {'MARKET'|'LIMIT'|'STOP_MARKET'|…} options.type  订单类型
     * @param {number|string} options.quantity  数量
     * @param {number|string} [options.price]   限价单价格
     * @param {boolean} [options.reduceOnly]    是否只用于减仓
     * @param {'GTC'|'IOC'|'FOK'} [options.timeInForce]
     * @returns {
     *  orderId:'',
     *  clientOrderId:''
     * }
     */
    async placeFuturesOrder(options) {
        return await client.futuresOrder(options);
    }

    /**
     * 取消订单
     * @param {string} symbol - 合约交易对（如 'ETHUSDT'）
     * @param {number} orderId - 要取消的订单 ID
     * @returns orderId: ,
     *   symbol: ,
     *   status: ,
     */
    async futuresCancel(symbol, orderId) {
        return await client.futuresCancel(symbol, orderId);
    }

    /**
     * 获取合成价格、汇率价格
     */
    async getSynPrice(baseSymbol, quotaSymbol) {
        let rlt = await client.futuresPrices();
        return Number((rlt[baseSymbol] / rlt[quotaSymbol]).toPrecision(5))
    }

    /**
     * 获取未成交的挂单
     * @param {string} symbol - 币安合约对，如 'ETHUSDT'
     * @returns {Promise<Array>} - 返回挂单数组
     */
    async getFuturesOpenOrders(symbol) {
        return await client.futuresOpenOrders(symbol)
    }

    /**
     * 根据 orderId 查询 Futures 合约订单状态
     * @param {string} symbol - 合约名称，例如 'ETHUSDT'
     * @param {number} orderId - 订单 ID
     * @returns
     * {
     *   "clientOrderId": "abc123",
     *   "cumQty": "0.01",
     *   "cumQuote": "29.55",
     *   "executedQty": "0.01",
     *   "orderId": 1234567890,
     *   "origQty": "0.01",
     *   "avgPrice": "2955.00",
     *   "price": "2955.00",
     *   "reduceOnly": false,
     *   "side": "BUY",
     *   "positionSide": "BOTH",
     *   "status": "FILLED",
     *   "symbol": "ETHUSDT",
     *   "time": 1672345678000,
     *   "type": "LIMIT",
     *   "updateTime": 1672345680000
     * }
     */
    async getFuturesOrder(symbol, orderId) {
        return await client.futuresOrderStatus(symbol, {'orderId': orderId})
    }

    /**
     * 修改订单
     */
    async futureModifyOrder(symbol, side, orderId, quantity, price, timestamp = Date.now()) {
        const endpoint = 'https://fapi.binance.com/fapi/v1/order';
        const params = {
            symbol, orderId, side, quantity, price, timestamp,
        };
        const query = new URLSearchParams(params).toString();
        const signature = crypto.createHmac('sha256', APISECRET)
            .update(query)
            .digest('hex');
        const url = `${endpoint}?${query}&signature=${signature}`;
        try {
            const res = await axios.put(url, null, {
                headers: {
                    'X-MBX-APIKEY': APIKEY
                }
            });
            return res.data;
        } catch (error) {
            console.error('修改失败：', error.response ? error.response.data : error.message);
            return {orderId}
        }
    }


    getFuturesTickerStream(baseAssert, quotaAssert, callback) {
        client.futuresMiniTickerStream(null, async tickers => {
            let baseP, quotaP;
            tickers.forEach(ele => {
                if (ele.symbol === baseAssert) {
                    baseP = ele.close
                }
                if (quotaAssert === ele.symbol) {
                    quotaP = ele.close
                }
            })
            if (baseP && quotaP) {
                await callback(baseP / quotaP)
            }
        })
    }

    async getTotalCommission(symbol) {
        let totalQuotaVol = 0;
        let limitQuotaVol = 0;
        let price = await this.getFuturesPrice('BNBUSDT');
        let trades = await client.futuresUserTrades(symbol, {startTime: 1748471000000});
        let reduce = trades.reduce((rlt, ele) => {
            let commission = ele.commission;
            let commissionAsset = ele.commissionAsset;
            if (!rlt[commissionAsset]) {
                rlt[commissionAsset] = 0;
            }
            totalQuotaVol += +ele.quoteQty;
            if ((commission * price) / (ele.quoteQty) * 100 <= 0.02) {
                limitQuotaVol += +ele.quoteQty;
            }
            rlt[commissionAsset] += +commission;
            return rlt;
        }, {});
        return {
            totalTxFee: +((reduce.USDT ? reduce.USDT : 0) + (reduce.USDC ? reduce.USDC : 0) + (reduce.BNB ? reduce.BNB * price : 0)),
            limitRate: (totalQuotaVol === 0 ? 0 : (limitQuotaVol * 100 / totalQuotaVol).toFixed(1)) + '%'
        }
    }

    async futuresDepth(symbol) {
        let rlt = await client.futuresDepth(symbol, {limit: 10});
        return {
            bids: rlt.bids, asks: rlt.asks
        };
    }

    async listKline(symbol, interval, params = {}) {
        return await client.candlesticks(symbol, interval, params);
    }
}
// let symbol = 'ETHUSDT';
// let qty = '0.006'
// let price = 4111;
// let czClient = new CzClient();
// czClient.futureBuy(symbol,qty,price).then(e=> console.log(e));
// //
// //
// let orderId = '8389765977923508000';
//
// czClient.getFuturesOrder(symbol,'orderId').then(e=> console.log(e));
// czClient.getFuturesOpenOrders(symbol).then(e=> console.log(e))
export default new CzClient();
