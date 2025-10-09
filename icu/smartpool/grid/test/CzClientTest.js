import czClient from "../CzClient.js";

let symbol = 'SOLUSDT';

// getSpotAccount test
czClient.getSpotAccount().then(e => console.table(e))
// futuresPrices test
czClient.getFuturesPrice(symbol).then(e => console.table(e));

// getFuturesAccount test
czClient.getFuturesAccount().then(e => console.table(e));

// getFuturesBalance test
czClient.getFuturesBalance().then(e => console.table(e))

// futureBuy test
// 下一笔不会立即成交的订单、下单成功后 先查询 在撤单
czClient.futureBuy(symbol, '0.12', '200').then(e => {
    console.table(e)
    let orderId = e.orderId;
    // getFuturesOrder test
    czClient.getFuturesOrder(symbol, orderId).then(e => console.log('get suc'))
    // cancelFuturesOrder test
    czClient.futuresCancel(symbol, orderId).then(r => console.log('cancel suc'))
})
// futureBuy test
czClient.futureSell(symbol,'0.12', '240').then(e => {
    console.table(e)
    let orderId = e.orderId;
    czClient.getFuturesOrder(symbol, orderId).then(e => console.log('get suc'))
    // cancelFuturesOrder test
    czClient.futuresCancel(symbol, orderId).then(r => console.log('cancel suc'))
})

// getFuturesPositionRisk test
czClient.getFuturesPositionRisk().then(e => console.table(e))

// getSynPrice test
czClient.getSynPrice('ETHUSDT', 'BTCUSDT').then(e => console.log(e))

// getFuturesOpenOrders test
czClient.getFuturesOpenOrders('TRXUSDT').then(e => console.table(e))
