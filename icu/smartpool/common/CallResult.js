class CallResult {

    loop(time) {
        return {
            'suc': true,
            'code': 1,
            'msg': '',
            'data': null,
            'time': time
        }
    }

    ok(data = null) {
        return {
            'suc': true,
            'code': 2,
            'msg': '',
            'data': data,
            'time': 10
        }
    }

    fail(msg = '') {
        return {
            'suc': false,
            'code': 0,
            'msg': msg,
            'data': null,
            'time': 10
        }
    }

    final(data = null) {
        return {
            'suc': true,
            'code': 3,
            'msg': '',
            'data': data,
            'time': 10
        }
    }
}

const callRlt = new CallResult();

export default callRlt;
