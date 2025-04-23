const axios = require('axios');

/**
 * 获取持仓数量
 */
async function getOi(symbol) {
    let rlt = await axios.get('https://fapi.binance.com/fapi/v1/openInterest?symbol=' + symbol, {});
    return rlt.data.openInterest
}

/**
 * 获取价格
 */
async function getPrice(symbol) {
    let rlt = await axios.get('https://fapi.binance.com/fapi/v2/ticker/price?symbol=' + symbol, {});
    return rlt.data.price
}

/**
 * 获取CMC coin id映射关系
 */
async function getCoinIdMap() {
    let rlt = await axios.get('https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map', {});
    return rlt.data.data.filter(ele => ele.is_active = 1 && ele.rank < 1000).reduce((rlt, cur) => {
        if (!rlt[cur.symbol] || rlt[cur.symbol].rank > cur.rank) {
            rlt[cur.symbol] = cur.id;
        }
        return rlt;
    }, {});
}

/**
 * 获取市值根据Id
 */
async function getCap(id) {
    let rlt = await axios.get('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?range=1H&id=' + id, {});
    return Object.entries(rlt.data.data.points).at(-1)[1]['v'][2]
}

async function main() {
    let coinIdMap = await getCoinIdMap();
    let contractList = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
    contractList = contractList.data.symbols
        // 非USDT币对、非数字货币币对
        .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status)
        // 新上市合约币对剔除
        .slice(0, -20)
        .map(ele => ele.symbol.replace('USDT', ''))
        // .filter(ele => coinIdMap[ele])
        .map(ele => {
            let id = coinIdMap[ele];
            return [ele.concat('USDT'), id]
        })
    let rlt = []
    for (let i = 0; i < contractList.length; i++) {
        let ets = contractList[i];
        console.log(i + 1 + '-->' + contractList.length)
        let symbol = ets[0];
        let id = ets[1];
        let cap = 0;
        if (id) {
            cap = await getCap(id);
            if (cap > 30000000) {
                continue
            }
        }
        let oiQty = await getOi(symbol);
        let price = await getPrice(symbol);
        let oiVal = oiQty * price;
        rlt.push([symbol, Number(price).toPrecision(3).concat('$'), (cap / 1000000).toFixed(1).concat('M'), (oiVal / 1000000).toFixed(1).concat('M'), (oiVal / cap).toFixed(2)]);
    }
    console.table(rlt
        .filter(ele => ele[2].startsWith('1'))
        .sort((e1, e2) => e2[4] - e1[4])
        .slice(0, 10))
    console.table(rlt
        .filter(ele => ele[2].startsWith('2'))
        .sort((e1, e2) => e2[4] - e1[4])
        .slice(0, 10))
    console.table(rlt
        .filter(ele => !ele[2].startsWith('2') && !ele[2].startsWith('1'))
        .sort((e1, e2) => e2[4] - e1[4])
        .slice(0, 10))
}

main().catch(ele => console.log(ele))
