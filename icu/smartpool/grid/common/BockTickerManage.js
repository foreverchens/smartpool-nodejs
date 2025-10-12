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
        'ws': ws, 'bid': null, 'ask': null, 'time': 0
    });
    console.log(`[Web Socket] ${symbol} subscribe suc`)
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
    let val = map.get(symbol?.toLowerCase());
    return [Number(val?.bid), Number(val?.ask), val?.time];
}




