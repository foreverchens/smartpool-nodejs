class CallResult {

    loop(time) {
        return {
            'suc': true,
            'msg': '',
            'data': null,
            'time': time
        }
    }

    ok(data = null) {
        return {
            'suc': true,
            'msg': '',
            'data': data,
            'time': 10
        }
    }

    fail(msg = '') {
        return {
            'suc': false,
            'msg': msg,
            'data': null
        }
    }
}

const callRlt = new CallResult();

export default callRlt;
