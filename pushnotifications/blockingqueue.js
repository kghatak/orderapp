// BlockingQueue is a simple implementation of a blocking queue.
// It allows you to enqueue items and dequeue them in a blocking manner.

export class BlockingQueue {
    constructor() {
        this.waiting = [];
        this.items = [];
    }

    enqueue(item) {
        if (this.waiting.length > 0) {
            const waiter = this.waiting.shift();
            waiter.resolve(item);
        } else {
            this.items.push(item);
        }
    }

    createDefferred() {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
    
        return { promise, resolve, reject };
    }    

    dequeue() {
        if (this.items.length > 0) {
            return items.shift();
        }
    
        const waiter = this.createDefferred();
        this.waiting.push(waiter);
        return waiter.promise;
    }
}
