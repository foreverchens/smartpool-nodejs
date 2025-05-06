class CircularQueue {
    constructor(capacity) {
        this.capacity = capacity;
        this.queue = new Array(capacity);
        this.head = 0; // 指向队头（最旧元素）
        this.tail = capacity - 1; // 指向队尾最新元素
        this.size = 0;
    }

    push(item) {
        if (this.size === this.capacity) {
            // 队满，覆盖最旧元素，移动 head 指针
            this.head = (this.head + 1) % this.capacity;
        } else {
            this.size++;
        }
        this.tail = (this.tail + 1) % this.capacity;
        this.queue[this.tail] = item;
    }

    /**
     * 获取最新的 len 个元素（从旧到新）
     */
    slice(len) {
        const result = [];
        const actualLen = Math.min(len, this.size);

        // 从 (tail - actualLen) 开始，向前取 actualLen 个元素
        for (let i = actualLen; i > 0; i--) {
            const index = (this.tail - i + this.capacity + 1) % this.capacity;
            result.push(this.queue[index]);
        }

        return result;
    }

    peek() {
        return this.queue[this.tail];
    }

    isEmpty() {
        return this.size === 0;
    }

    isFull() {
        return this.size === this.capacity;
    }

    toArray() {
        const result = [];
        for (let i = 0; i < this.size; i++) {
            const index = (this.head + i) % this.capacity;
            result.push(this.queue[index]);
        }
        return result;
    }
}

export default CircularQueue;



