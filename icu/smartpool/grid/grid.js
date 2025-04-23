const czClient = require('./CzClient');
const fs = require('fs')
// 2480 + 50
const baseAssert = 'TRXUSDT'
const quotaAssert = 'BNBUSDC'

// 等比网格、单网格比例
let gridRate = 0.003;
// 单网格交易仓位等值USDT
let gridValue = 300;
let curPrice, buyPrice, sellPrice;

function updateConfig() {
    try {
        const content = fs.readFileSync('./common/' + baseAssert + '_' + quotaAssert + '_config.json', 'utf-8');
        let config = JSON.parse(content);
        // 更新参数
        gridValue = config.gridValue;
        if (gridRate !== config.gridRate) {
            // 更新单格利率、和下一交易汇率
            console.log('利率更新: %s -> %s', gridRate, config.gridRate)
            gridRate = config.gridRate;
            buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
            sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
        }
    } catch (err) {
        console.error('config.json 404')
    }
}

function formatQtyByPrice(price, qty) {
    if (price < 1) {
        return Math.floor(qty)
    } else if (price > 10000) {
        return qty.toFixed(3)
    } else if (price > 100) {
        return qty.toFixed(2)
    } else {
        return qty.toFixed(1);
    }
}

/**
 * 检查订单成交否
 */
async function orderCallback(baseOrderId, quotaOrderId) {
    let baseOrder = await czClient.getFuturesOrder(baseAssert, baseOrderId);
    let quotaOrder = await czClient.getFuturesOrder(quotaAssert, quotaOrderId);
    if (baseOrder.status !== 'NEW' && quotaOrder.status !== 'NEW') {
        console.log('订单Id[%s,%s]完全成交', baseOrderId, quotaOrderId)
        // 写入文件
        let rlt = [baseOrder.symbol, baseOrder.side, curPrice, baseOrder.price, baseOrder.origQty, baseOrder.orderId, Date.now()].join(',') + '\n';
        fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
        rlt = [quotaOrder.symbol, quotaOrder.side, curPrice, quotaOrder.price, quotaOrder.origQty, quotaOrder.orderId, Date.now()].join(',') + '\n';
        fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
        return
    }
    if (baseOrder.status === 'NEW') {
        // 撤单
        await czClient.futuresCancel(baseAssert, baseOrderId);
        let sideBuy = baseOrder.side === 'BUY'
        // 重新获取订单簿
        let baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
        let baseP = sideBuy ? baseOrderBook.bidPrice : baseOrderBook.askPrice;
        // 最新价重新挂单
        baseOrder = sideBuy ? await czClient.futureBuy(baseAssert, baseOrder.origQty, baseP) : await czClient.futureSell(baseAssert, baseOrder.origQty, baseP)
        console.log('%s-重新挂单[%s-->%s]', baseAssert, baseOrderId, baseOrder.orderId)
    }
    if (quotaOrder.status === 'NEW') {
        // 撤单
        await czClient.futuresCancel(quotaAssert, quotaOrderId);
        let sideBuy = quotaOrder.side === 'BUY'
        // 重新获取订单簿
        let quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
        let quotaP = sideBuy ? quotaOrderBook.bidPrice : quotaOrderBook.askPrice;
        // 最新价重新挂单
        quotaOrder = sideBuy ? await czClient.futureBuy(quotaAssert, quotaOrder.origQty, quotaP) : await czClient.futureSell(quotaAssert, quotaOrder.origQty, quotaP)
        console.log('%s-重新挂单[%s-->%s]', quotaAssert, quotaOrderId, quotaOrder.orderId)
    }
    setTimeout(() => {
        orderCallback(baseOrder.orderId, quotaOrder.orderId)
    }, 1000 * 2)
}

async function gridLoop() {
    updateConfig();
    // 获取最新汇率
    curPrice = await czClient.getSynPrice(baseAssert, quotaAssert);
    console.log('当前汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
    if (curPrice < buyPrice || curPrice > sellPrice) {
        let baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
        let baseP = baseOrderBook.bidPrice;
        let baseQty = formatQtyByPrice(baseP, gridValue / baseP)

        let quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
        let quotaP = quotaOrderBook.bidPrice;
        let quotaQty = formatQtyByPrice(quotaP, gridValue / quotaP)
        console.log('baseP:%s,baseQty:%s', baseP, baseQty)
        console.log('quotaP:%s,quotaQty:%s', quotaP, quotaQty)
        let baseOrder, quotaOrder;
        if (curPrice < buyPrice) {
            // 汇率降低、
            // 买入gridValue等值base资产、卖出等值quota资产
            baseOrder = await czClient.futureBuy(baseAssert, baseQty, baseP);
            quotaOrder = await czClient.futureSell(quotaAssert, quotaQty, quotaOrderBook.askPrice)
            console.log('当前汇率%s低于买入汇率价%s、执行买入%s刀%s、卖出%s刀%s、订单时间：%s\n买单:%s\n卖单:%s', curPrice, buyPrice, gridValue, baseAssert, gridValue, quotaAssert, Date.now(), baseOrder, quotaOrder)
        } else {
            // 汇率上涨
            // 卖出gridValue等值base资产、买入等值quota资产
            baseOrder = await czClient.futureSell(baseAssert, baseQty, baseOrderBook.askPrice);
            quotaOrder = await czClient.futureBuy(quotaAssert, quotaQty, quotaP);
            console.log('当前汇率%s高于卖出汇率价%s、执行卖出%s刀 %s、买入%s刀%s、订单时间：%s\n卖单:%s\n买单:%s', curPrice, sellPrice, gridValue, baseAssert, gridValue, quotaAssert, Date.now(), baseOrder, quotaOrder)
        }
        buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
        sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
        setTimeout(() => {
            orderCallback(baseOrder.orderId, quotaOrder.orderId)
        }, 1000 * 2)
    }
    // 每 5 秒轮询一次
    setTimeout(gridLoop, 1000 * 5)
}

async function Main() {
    // 获取最新汇率
    curPrice = await czClient.getSynPrice(baseAssert, quotaAssert);
    buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
    sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
    console.log('初始汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
    await gridLoop();
}

Main().catch(e => console.log(e))
