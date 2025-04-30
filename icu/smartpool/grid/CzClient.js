const Binance = require('node-binance-api');
const axios = require('axios');
const crypto = require('crypto');

const APIKEY = 'qbc5djgYcospWpt5RNwBUgVesnzAP0jj68ZXeciXuBSRQGPVbExQomZKjYenuZ1Q';
const APISECRET = '40pOBNmUndKuGY33nqNi8SMMuC3GsWTA8aRP7rb4fHZDpUE4CDEKhVKoSFkqqTqx';
const client = new Binance({
    APIKEY: APIKEY, APISECRET: APISECRET,
})

/**
 * 获取现货账户余额
 * @returns {Promise<Object>} { balances: [{ asset, free, locked }] }
 */
async function getSpotAccount() {
    const info = await client.account();
    const balances = info.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({asset: b.asset, free: b.free, locked: b.locked}));
    return balances;
}

/**
 * 获取合约账户余额
 * @returns {Promise<Object>} { assets: [{ asset, walletBalance, unrealizedProfit, marginBalance }] }
 */
async function getFuturesAccount() {
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
 * 获取合约账户保证金余额、没用
 */
async function getFuturesBalance() {
    let rlt = await client.futuresBalance();
    return rlt.filter(a => parseFloat(a.balance) !== 0)
        .map(a => ({
            asset: a.asset, walletBalance: a.balance
        }));
}

async function futureBuy(symbol, qty, price) {
    return await client.futuresBuy(symbol, qty, price, {'timeInForce': 'GTC'});
}

async function futureSell(symbol, qty, price) {
    return await client.futuresSell(symbol, qty, price, {'timeInForce': 'GTC'});
}

/**
 * 批量下单
 */
async function futureMultiOrder(orders) {
    return await client.futuresMultipleOrders(orders);
}

/**
 * 获取合约持仓核心数据
 * @returns {Promise<Array>} [{ symbol, positionAmt, entryPrice, unrealizedProfit, leverage }]
 */
async function getFuturesPositionRisk(symbol = '') {
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
async function getFuturesPrice(symbol) {
    let rlt = await client.futuresPrices(symbol);
    return rlt[symbol];
}

/**
 * 获取最新订单簿价格
 */
async function getFuturesBookTicker(symbol) {
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
async function placeFuturesOrder(options) {
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
async function futuresCancel(symbol, orderId) {
    return await client.futuresCancel(symbol, orderId);
}

/**
 * 获取合成价格、汇率价格
 */
async function getSynPrice(baseSymbol, quotaSymbol) {
    let rlt = await client.futuresPrices();
    return (rlt[baseSymbol] / rlt[quotaSymbol]).toPrecision(5)
}

/**
 * 获取未成交的挂单
 * @param {string} symbol - 币安合约对，如 'ETHUSDT'
 * @returns {Promise<Array>} - 返回挂单数组
 */
async function getFuturesOpenOrders(symbol) {
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
async function getFuturesOrder(symbol, orderId) {
    return await client.futuresOrderStatus(symbol, {'orderId': orderId})
}

function getFuturesTickerStream(baseAssert, quotaAssert, callback) {
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


module.exports = {
    getSpotAccount,
    getFuturesAccount,
    getFuturesBalance,
    futureBuy,
    futureSell,
    getFuturesPositionRisk,
    getFuturesPrice,
    getFuturesBookTicker,
    placeFuturesOrder,
    futuresCancel,
    getSynPrice,
    getFuturesOpenOrders,
    getFuturesOrder,
    futureMultiOrder,
    getFuturesTickerStream
};