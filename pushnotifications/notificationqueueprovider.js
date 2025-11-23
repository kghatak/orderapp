import { QueueProcessor } from "./queueprocessor.js";

let queueProcessor = null;

export function initQueueProcessor() {
    if (!queueProcessor) {
        queueProcessor = new QueueProcessor();
        queueProcessor.startProcessing();
    }
}

export function getQueueProcessor() {
    if (!queueProcessor) {
        throw new Error('Queue processor not initialized');
    }
    return queueProcessor;
}

