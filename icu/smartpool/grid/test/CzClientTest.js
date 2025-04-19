const czClient = require('../CzClient')

let symbol = 'BTCUSDT';

// getSpotAccount test
czClient.getSpotAccount().then(e => console.table(e))
// futuresPrices test
czClient.getFuturesPrice(symbol).then(e => console.table(e));

// getFuturesAccount test
czClient.getFuturesAccount().then(e => console.table(e));

// getFuturesBalance test
czClient.getFuturesBalance().then(e => console.table(e))

// futureBuy test
czClient.futureBuy(symbol, '0.003', '80000').then(e => {
    console.table(e)
    let orderId = e.orderId;
    // getFuturesOrder test
    czClient.getFuturesOrder(symbol,orderId).then(e => console.log(e))
    // cancelFuturesOrder test
    czClient.futuresCancel(symbol, orderId).then(r => console.log(r))
})
// futureBuy test
czClient.futureSell(symbol, '0.003', '90000').then(e => {
    console.table(e)
    let orderId = e.orderId;
    // cancelFuturesOrder test
    czClient.futuresCancel(symbol, orderId).then(r => console.log(r))
})

// getFuturesPositionRisk test
czClient.getFuturesPositionRisk().then(e => console.table(e))

// getSynPrice test
czClient.getSynPrice('ETHUSDT', 'BTCUSDT').then(e => console.log(e))

// getFuturesOpenOrders test
czClient.getFuturesOpenOrders('TRXUSDT').then(e => console.table(e))
