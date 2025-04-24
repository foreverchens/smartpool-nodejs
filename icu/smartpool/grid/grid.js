const czClient = require('./CzClient');
const fs = require('fs')
// 2480 + 50
const baseAssert = 'TRXUSDT'
const quotaAssert = 'USDT'

const simpleGrid = quotaAssert === 'USDT';

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
    let baseOrder = {}, quotaOrder = {};
    if (baseOrderId) {
        baseOrder = await czClient.getFuturesOrder(baseAssert, baseOrderId);
    }
    if (quotaOrderId) {
        quotaOrder = await czClient.getFuturesOrder(quotaAssert, quotaOrderId);
    }
    if ((simpleGrid && baseOrder && baseOrder.status !== 'NEW') || (baseOrder && quotaOrder && baseOrder.status !== 'NEW' && quotaOrder.status !== 'NEW')) {
        console.log('订单Id[%s,%s]完全成交', baseOrderId, quotaOrderId)
        // 写入文件
        let rlt = [baseOrder.symbol, baseOrder.side, curPrice, baseOrder.price, baseOrder.origQty, baseOrder.orderId, Date.now()].join(',') + '\n';
        fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
        if (!simpleGrid) {
            rlt = [quotaOrder.symbol, quotaOrder.side, curPrice, quotaOrder.price, quotaOrder.origQty, quotaOrder.orderId, Date.now()].join(',') + '\n';
            fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
        }
        return
    }
    if (baseOrder && baseOrder.status === 'NEW') {
        // 撤单
        await czClient.futuresCancel(baseAssert, baseOrderId);
        let sideBuy = baseOrder.side === 'BUY'
        // 重新获取订单簿
        let baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
        let baseP = sideBuy ? baseOrderBook.bidPrice : baseOrderBook.askPrice;
        // 最新价重新挂单
        baseOrder = sideBuy ? await czClient.futureBuy(baseAssert, baseOrder.origQty, baseP) : await czClient.futureSell(baseAssert, baseOrder.origQty, baseP)
        console.log('%s-%s重新挂单[%s-->%s]', baseAssert, baseP, baseOrderId, baseOrder.orderId)
    }
    if (!simpleGrid && quotaOrder && quotaOrder.status === 'NEW') {
        // 撤单
        await czClient.futuresCancel(quotaAssert, quotaOrderId);
        let sideBuy = quotaOrder.side === 'BUY'
        // 重新获取订单簿
        let quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
        let quotaP = sideBuy ? quotaOrderBook.bidPrice : quotaOrderBook.askPrice;
        // 最新价重新挂单
        quotaOrder = sideBuy ? await czClient.futureBuy(quotaAssert, quotaOrder.origQty, quotaP) : await czClient.futureSell(quotaAssert, quotaOrder.origQty, quotaP)
        console.log('%s-%s重新挂单[%s-->%s]', quotaAssert, quotaP, quotaOrderId, quotaOrder.orderId)
    }
    setTimeout(() => {
        orderCallback(baseOrder.orderId, quotaOrder.orderId)
    }, 1000 * 2)
}

async function gridLoop() {
    updateConfig();
    // 获取最新汇率
    curPrice = await getCurPrice();
    console.log('当前汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
    if (curPrice < buyPrice || curPrice > sellPrice) {
        let baseOrderBook, quotaOrderBook;
        let baseP, quotaP;
        let baseQty, quotaQty;

        baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
        baseP = baseOrderBook.bidPrice;
        baseQty = formatQtyByPrice(baseP, gridValue / baseP)
        console.log('baseP:%s,baseQty:%s', baseP, baseQty)

        if (!simpleGrid) {
            quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
            quotaP = quotaOrderBook.bidPrice;
            quotaQty = formatQtyByPrice(quotaP, gridValue / quotaP)
            console.log('quotaP:%s,quotaQty:%s', quotaP, quotaQty)
        }

        let baseOrder = {}, quotaOrder = {};
        if (curPrice < buyPrice) {
            // 汇率降低、
            // 买入gridValue等值base资产、卖出等值quota资产
            baseOrder = await czClient.futureBuy(baseAssert, baseQty, baseP);
            console.log('当前汇率%s低于买入汇率价%s、执行买入%s刀%s、订单时间：%s\n买单:%s', curPrice, buyPrice, gridValue, baseAssert, Date.now(), baseOrder)
            if (!simpleGrid) {
                quotaOrder = await czClient.futureSell(quotaAssert, quotaQty, quotaOrderBook.askPrice)
                console.log('当前汇率%s低于买入汇率价%s、执行卖出%s刀%s、订单时间：%s\n卖单:%s', curPrice, buyPrice, gridValue, quotaAssert, Date.now(), quotaOrder)
            }
        } else {
            // 汇率上涨
            // 卖出gridValue等值base资产、买入等值quota资产
            baseOrder = await czClient.futureSell(baseAssert, baseQty, baseOrderBook.askPrice);
            console.log('当前汇率%s高于卖出汇率价%s、执行卖出%s刀 %s、订单时间：%s\n卖单:%s', curPrice, sellPrice, gridValue, baseAssert, Date.now(), baseOrder)
            if (!simpleGrid) {
                quotaOrder = await czClient.futureBuy(quotaAssert, quotaQty, quotaP);
                console.log('当前汇率%s高于卖出汇率价%s、执行买入%s刀%s、订单时间：%s\n买单:%s', curPrice, sellPrice, gridValue, quotaAssert, Date.now(), quotaOrder)
            }
        }
        buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
        sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
        setTimeout(() => {
            orderCallback(baseOrder.orderId, quotaOrder.orderId)
        }, 1000 * 2)
    }
}

async function getCurPrice() {
    return simpleGrid ? await czClient.getFuturesPrice(baseAssert) : await czClient.getSynPrice(baseAssert, quotaAssert);
}

async function Main() {
    // 获取最新汇率
    curPrice = await getCurPrice();
    buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
    sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
    console.log('初始汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
    // 每 5 秒轮询一次
    setInterval(gridLoop, 1000 * 5)
}

Main().catch(e => console.log(e))
