const axios = require("axios");

async function getOi(symbol) {
    let url = 'https://fapi.binance.com/fapi/v1/premiumIndex';
    let rlt = await axios.get(url, {});
    let data = rlt.data;
    data = data.map(ele => [ele.symbol, (Number(ele.lastFundingRate) * 100).toFixed(2)])
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .slice(0,5);
    console.table(data);
}

getOi()


