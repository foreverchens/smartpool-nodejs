export function formatQty(symbol, price, qty) {
    symbol = symbol.toUpperCase().substring(0, 3);
    switch (symbol) {
        case 'BTC':
            return qty.toFixed(3);
        case 'ETH':
            return qty.toFixed(3);
        default:
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
}
