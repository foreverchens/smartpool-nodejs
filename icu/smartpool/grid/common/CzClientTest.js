let symbol = 'SUIUSDC';

// getSpotAccount test
// czClient.getSpotAccount().then(e => console.table(e))
// // futuresPrices test
// czClient.getFuturesPrice(symbol).then(e => console.table(e));
//
// // getFuturesAccount test
// czClient.getFuturesAccount().then(e => console.table(e));
//
// // getFuturesBalance test
// czClient.getFuturesBalance().then(e => console.table(e))

// futureBuy test
// 下一笔不会立即成交的订单、下单成功后 先查询 在撤单
// czClient.futureBuy(symbol, '5', '2.4').then(e => {
//     console.table(e)
//     let orderId = e.orderId;
//     // getFuturesOrder test
//     czClient.getFuturesOrder(symbol, orderId).then(e => {
//         console.log(e)
//     })
//     // cancelFuturesOrder test
//     // czClient.futuresCancel(symbol, orderId).then(r => console.log('cancel suc'))
// })
// // futureBuy test
// czClient.futureSell(symbol,'0.12', '240').then(e => {
//     console.table(e)
//     let orderId = e.orderId;
//     czClient.getFuturesOrder(symbol, orderId).then(e => console.log('get suc'))
//     // cancelFuturesOrder test
//     czClient.futuresCancel(symbol, orderId).then(r => console.log('cancel suc'))
// })
//
// // getFuturesPositionRisk test
// czClient.getFuturesPositionRisk().then(e => console.table(e))
//
// // getSynPrice test
// czClient.getSynPrice('ETHUSDT', 'BTCUSDT').then(e => console.log(e))
//
// // getFuturesOpenOrders test
// czClient.getFuturesOpenOrders('TRXUSDT').then(e => console.table(e))


// GTX策略测试
// async function placeOrder(symbol, isAsk, qty, price) {
//     let p = await czClient.getFuturesPrice(symbol);
//     try {
//         return isAsk
//             ? await czClient.futureSell(symbol, qty, price ?? p)
//             : await czClient.futureBuy(symbol, qty, price ?? p);
//     } catch (err) {
//         if (err.message.includes('-5022')) {
//             // gtx订单无法maker被拒单
//             console.log('gxc failed')
//             // https://developers.binance.com/docs/zh-CN/derivatives/usds-margined-futures/error-code#-5022-gtx_order_reject
//             return placeOrder(symbol, isAsk, qty);
//         }
//         return {'msg': err.message};
//     }
// }

// placeOrder('ethusdc', 0, 0.005, 4000)
//     .then(rlt => {
//         if (rlt.msg) {
//             console.log(rlt.msg)
//         } else {
//             console.log(rlt);
//             console.log('place order suc ')
//             czClient.futuresCancel('ethusdc', rlt.orderId).then(r => console.log('cancel suc'))
//         }
//     })

// place->modify->get->replace
// let test1 = async () => {
//     let order = await czClient.placeOrder('ethusdc', 0, 0.005);
//     console.log(order);
//     setTimeout(async () => {
//         order = await czClient.futureModifyOrder(order.symbol, order.side, order.orderId, order.origQty, 4100);
//         console.log(order);
//     }, 2000)
//
// }
// test1().then(e => console.log(e));


// getFuturesPositionRisk
// let rlt = await czClient.getFuturesPositionRisk();
// console.log(rlt);