import axios from "axios";


/**
 * 成交量分布测试
 * 测试378个
 * 200M以上 18～5%
 * 100M以上 15～5%
 * 50M以上 20～5%
 * 20M以上 54～15%
 * 20M以下 271～70%
 */
(async () => {
    let volList = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {});
    volList = volList.data.reduce((acc, item) => {
        acc[item.symbol] = item.quoteVolume;
        return acc;
    }, {});
    let list = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
    list = list.data.symbols
        // 非USDT币对、非数字货币币对
        .filter(ele => ele.symbol.endsWith('USDT') && "TRADING" === ele.status)
        // 新上市合约币对剔除
        .slice(0, -20)
        .map(ele => {
            return {
                symbol: ele.symbol, vol: Number(volList[ele.symbol])
            };
        })
        .sort((a, b) => b.vol - a.vol)

    let rlt = [
        [], // <20M
        [], // 20~50M
        [], // 50~100M
        [], // 100M~200M
        [] // >200M
    ]
    list.forEach(ele => {
        let vol = ele.vol;
        if (vol < 2000_0000) {
            rlt[0].push(ele)
        } else if (vol < 5000_0000) {
            rlt[1].push(ele)
        } else if (vol < 10000_0000) {
            rlt[2].push(ele)
        } else if (vol < 20000_0000) {
            rlt[3].push(ele)
        } else {
            rlt[4].push(ele)
        }
    })
    rlt.forEach(ele => console.table(ele))
})()