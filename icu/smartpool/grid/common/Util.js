import axios from "axios";


let rlt = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {});
const precisionMap = rlt.data.symbols
    .filter(ele => "TRADING" === ele.status)
    .reduce((rlt, cur) => {
        rlt[cur.symbol] = [cur.pricePrecision, cur.quantityPrecision]
        return rlt;
    }, {})

export function formatQty(symbol, price, qty) {
    symbol = symbol?.toUpperCase();
    let rlt = precisionMap[symbol];
    return qty.toFixed(rlt[1]);
}

