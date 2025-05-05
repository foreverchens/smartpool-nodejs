function klineParam(symbol, limit, startTime, endTime, period) {
    return {
        symbol, limit, startTime, endTime, period
    }
}

function kline(openT, openP, highP, lowP, closeP) {
    return {
        openT, openP, highP, lowP, closeP
    }
}

function H1Kline(openT, lowP, highP, dataArr) {
    return {
        openT, lowP, highP, dataArr
    }
}

function ShakeScore(symbol, score, amplitude, lowP, highP, pricePosition) {
    return {
        symbol, score, amplitude, lowP, highP, pricePosition
    }
}

module.exports = {klineParam, kline, H1Kline, ShakeScore}
