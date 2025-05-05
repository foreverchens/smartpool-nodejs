import axios from "axios";

let url = 'https://fapi.binance.com/fapi/v1/premiumIndex';
let rlt = await axios.get(url, {});
let data = rlt.data;
data = data.map(ele => [ele.symbol, (Number(ele.lastFundingRate) * 100).toFixed(2)])
    .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
    .slice(0, 5);
console.table(data);
