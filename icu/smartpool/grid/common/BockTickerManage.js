import * as timers from "node:timers";
import logger from './logger.js';
import {connect} from './WsClient.js';

const map = new Map();

let tickerHandle = (symbol, data) => {
    let val = map.get(symbol);
    val.bid = data.b;
    val.ask = data.a;
    val.time = data.T;
}

/**
 * 订阅wss
 * @param symbol
 */
export function subscribe(symbol) {
    symbol = symbol.toLowerCase();
    let ws = connect(symbol, tickerHandle);
    map.set(symbol, {
        'ws': ws, 'bid': null, 'ask': null, 'time': 0, 'restarting': false
    });
    logger.info(`[Web Socket] ${symbol} subscribe suc`);
}

/**
 * 取消wss订阅
 * @param symbol
 */
export function unsubscribe(symbol) {
    let val = map.get(symbol?.toLowerCase());
    val?.ws?.close(1000, 'manual close');
}

/**
 *  获取最优价格
 * @param symbol
 * @returns {*[]} [bestBidPrice,bestAskPrice]
 */
export function getTicker(symbol) {
    symbol = symbol?.toLowerCase();
    const val = map.get(symbol);
    const now = Date.now();
    // 如果 ticker 超过阈值未更新，则触发一次重连
    if (val.time && val.time + 5000 < now && !val.restarting) {
        val.restarting = true;
        try {
            val.ws?.close(1012, 'stale ticker restart');
        } catch (err) {
            logger.warn(`[Web Socket] ${symbol} close error`, err?.message || err);
        }
        timers.setTimeout(() => {
            subscribe(symbol);
        }, 200);
    }
    return [Number(val.bid), Number(val.ask), val.time];
}


// subscribe('btcusdt');
// setInterval(()=>{
//     console.log(getTicker('btcusdt'));
// })


