const czClient = require('./CzClient');
const fs = require('fs')
const baseAssert = 'TRXUSDT'
const quotaAssert = 'BTCUSDT'

// 等比网格、单网格比例
let gridRate = 0.005;
// 单网格交易仓位等值USDT
let gridValue = 200;
let curPrice, buyPrice, sellPrice;

function loadConfig() {
    const content = fs.readFileSync('./config.json', 'utf-8');
    return JSON.parse(content);
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

async function gridLoop() {
    let config = loadConfig();
    // 更新参数
    gridValue = config.gridValue;
    if (gridRate !== config.gridRate) {
        // 更新单格利率、和下一交易汇率
        console.log('利率更新: %s -> %s', gridRate, config.gridRate)
        gridRate = config.gridRate;
        buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
        sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
    }
    // 获取最新汇率
    curPrice = await czClient.getSynPrice(baseAssert, quotaAssert);
    console.log('当前汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
    if (curPrice < buyPrice || curPrice > sellPrice) {
        let baseP = await czClient.getFuturesPrice(baseAssert);
        let baseQty = formatQtyByPrice(baseP, gridValue / baseP)
        let quotaP = await czClient.getFuturesPrice(quotaAssert);
        let quotaQty = formatQtyByPrice(quotaP, gridValue / quotaP)
        console.log('baseP:%s,baseQty:%s', baseP, baseQty)
        console.log('quotaP:%s,quotaQty:%s', quotaP, quotaQty)
        let baseOrder, quotaOrder;
        if (curPrice < buyPrice) {
            // 汇率降低、
            // 买入gridValue等值base资产、卖出等值quota资产
            baseOrder = await czClient.futureBuy(baseAssert, baseQty, baseP);
            quotaOrder = await czClient.futureSell(quotaAssert, quotaQty, quotaP)
            console.log('当前汇率%s低于买入汇率价%s、执行买入%s刀%s、卖出%s刀%s、订单时间：%s\n买单:%s\n卖单:%s', curPrice, buyPrice, gridValue, baseAssert, gridValue, quotaAssert, Date.now(), baseOrder, quotaOrder)
        } else {
            // 汇率上涨
            // 卖出gridValue等值base资产、买入等值quota资产
            baseOrder = await czClient.futureSell(baseAssert, baseQty, baseP);
            quotaOrder = await czClient.futureBuy(quotaAssert, quotaQty, quotaP);
            console.log('当前汇率%s高于卖出汇率价%s、执行卖出%s刀 %s、买入%s刀%s、订单时间：%s\n卖单:%s\n买单:%s', curPrice, sellPrice, gridValue, baseAssert, gridValue, quotaAssert, Date.now(), baseOrder, quotaOrder)
        }
        buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
        sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
        // 写入文件
        let rlt = [baseOrder.symbol, baseOrder.side, curPrice, baseOrder.price, baseOrder.origQty, baseOrder.orderId, Date.now()].join(',') + '\n';
        fs.appendFileSync('./database.txt', rlt);
        rlt = [quotaOrder.symbol, quotaOrder.side, curPrice, quotaOrder.price, quotaOrder.origQty, quotaOrder.orderId, Date.now()].join(',') + '\n';
        fs.appendFileSync('./database.txt', rlt);
    }
    // 每 30 秒轮询一次
    setTimeout(gridLoop, 1000 * 60)
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
