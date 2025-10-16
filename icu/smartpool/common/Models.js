class Models {
    klineParam(symbol, limit, startTime, endTime, period) {
        return {
            symbol, limit, startTime, endTime, period
        }
    }

    kline(openT, openP, highP, lowP, closeP) {
        return {
            openT, openP, highP, lowP, closeP
        }
    }

    H1Kline(openT, lowP, highP, dataArr, rise) {
        return {
            openT, lowP, highP, dataArr, rise,
        }
    }

    ShakeScore(symbol, score, amp, lowP, highP, pricePosit) {
        return {
            symbol, score, amp, lowP, highP, pricePosit
        }
    }
}
export default new Models();

