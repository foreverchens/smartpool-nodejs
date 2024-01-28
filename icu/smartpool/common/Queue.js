class Queue {
    constructor(size) {
        this.arr = new Array(size).fill(0);
    }

    push(ele) {
        this.arr.shift()
        return this.arr.push(ele);
    }

    peek() {
        return this.arr.at(-1);
    }
    slice(len){
        return this.arr.slice(-len);
    }

    isEmpty(){
        return this.peek() === 0;
    }
}
module.exports = Queue;
