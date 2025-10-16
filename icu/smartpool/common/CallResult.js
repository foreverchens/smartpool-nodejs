class CallResult {

    ok(data = null) {
        return {
            'suc': true,
            'msg': '',
            'data': data
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
