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

    H1Kline(openT, lowP, highP, dataArr,rise) {
        return {
            openT, lowP, highP, dataArr,rise,
        }
    }

    ShakeScore(symbol, score, amplitude, lowP, highP, pricePosition) {
        return {
            symbol, score, amplitude, lowP, highP, pricePosition
        }
    }
}
export default new Models();

