import axios from "axios";
async function getOi(symbol, period = '1d', limit = 30) {
    let url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&limit=${limit}&period=${period}`;
    let rlt = await axios.get(url, {});
    return rlt.data
}

function formatNumber(num) {
    if (num === null || num === undefined) return '-';

    const absNum = Math.abs(num);
    if (absNum >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    } else if (absNum >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    } else if (absNum >= 1_000) {
        return (num / 1_000).toFixed(2) + 'K';
    } else {
        return num.toPrecision(2).toString();
    }
}

async function getCoinIdMap() {
    let rlt = await axios.get('https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map', {});
    return rlt.data.data.filter(ele => ele.is_active = 1 && ele.rank < 1000).reduce((rlt, cur) => {
        if (!rlt[cur.symbol] || rlt[cur.symbol].rank > cur.rank) {
            rlt[cur.symbol.concat('USDT')] = cur.id;
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

async function getPrice(symbol) {
    let rlt = await axios.get('https://fapi.binance.com/fapi/v2/ticker/price?symbol=' + symbol, {});
    return rlt.data.price
}

async function main() {
    let contractList = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
    contractList = contractList.data.symbols
        // 非USDT币对、非数字货币币对
        .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status)
        // 新上市合约币对剔除
        .slice(0, -20)
    let rlt1d = [];
    let rlt4h = []
    let coinIdMap = await getCoinIdMap();
    for (let i = 0; i < contractList.length; i++) {
        let symbol = contractList[i].symbol;
        console.log('[%s-->%s]', i + 1, contractList.length)
        let oiData = await getOi(symbol);
        if (Number(oiData.at(-1).sumOpenInterestValue) > 2000_0000 || Number(oiData.at(-1).sumOpenInterestValue) < 200_0000) {
            // 持仓量[2M,20M]
            continue;
        }
        let oi1 = oiData[0].sumOpenInterest;
        let oi3 = oiData.at(-1).sumOpenInterest;
        let rate30 = ((oi3 - oi1) / oi1).toFixed(2);
        if (Number(rate30) < 0.5) {
            // 30天持仓增加量过低
            continue
        }
        let oiMax = oiData.reduce((max, ele) => Math.max(max, Number(ele.sumOpenInterest)), -Infinity);
        if (oiMax * 0.8 > oi3) {
            // 持仓出现大额回落、最新持仓较高点跌去至少20%
            console.log(symbol)
            continue
        }
        let id = coinIdMap[symbol];
        let cap = 0;
        if (id) {
            cap = await getCap(id);
            if (Number(cap) > 5000_0000) {
                continue;
            }
        }
        let price = await getPrice(symbol);
        let oiVal = price * oi3;
        let oiValRate = oiVal / cap;
        if (oiValRate < 0.1) {
            continue;
        }
        rlt1d.push([symbol, formatNumber(oi3), formatNumber(oiMax), rate30, formatNumber(oiVal), formatNumber(cap), formatNumber(oiValRate)])
    }
    rlt1d = rlt1d.sort((a, b) => b[6] - a[6])
    console.log(['symbol', '当前持仓量', '近一月最高持仓量', '近一月持仓增幅', '持仓价值', '代币市值', '持仓市值比'])
    console.table(rlt1d);
}

main().catch(e => console.log(e))
