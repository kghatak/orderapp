import {BlockingQueue} from './blockingqueue.js';
import { sendPushNotification } from '../util/firebase.js';


export class QueueProcessor {
    constructor() {
        this.blockingQueue = new BlockingQueue();
    }

    async startProcessing() {
        while(true) {
            const message = await this.blockingQueue.dequeue();
                        switch(message.messageType) {
                case 'orderStatusUpdate':
                    sendPushNotification(message.messageBody);
                    break;
                default:
                    console.error(`Unknown message type: ${message.messageType}`);
            }
        }
    }

    enqueue(message) {
        this.blockingQueue.enqueue(message);
    }
}