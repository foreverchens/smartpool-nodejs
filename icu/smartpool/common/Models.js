function klineParam(symbol,limit,startTime,endTime){
    return {
        "symbol":symbol,
        "limit":limit,
        "startTime":startTime,
        "endTime":endTime
    }
}

function kline(openT,openP,highP,lowP,closeP){
    return {
        "openT":openT,
        "openP":openP,
        "highP":highP,
        "lowP":lowP,
        "closeP":closeP,
    }
}

function H1Kline(openT,lowP,highP,dataArr){
    return {
        "openT":openT,
        "lowP":lowP,
        "highP":highP,
        "dataArr":dataArr,
    }
}

function ShakeScore(symbol,score,amplitude,lowP,highP){
    return {
        "symbol":symbol,
        "score":score,
        "amplitude":amplitude,
        "lowP":lowP,
        "highP":highP,
    }
}

module.exports = {klineParam,kline,H1Kline,ShakeScore}
