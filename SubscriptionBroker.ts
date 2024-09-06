import type { ProtocolUpdateMessage } from '@/architect'

type Context = {
  subscribers: [number, WebSocket][]
  messages: unknown[]
}

export default class SubscriptionBroker {
  topics: Map<string, Context> = new Map()

  private getOrCreateTopic(topic: string): Context {
    let context = this.topics.get(topic)
    if (!context) {
      context = { subscribers: [], messages: [] }
      this.topics.set(topic, context)
    }
    return context
  }

  subscribe(topic: string, id: number, ws: WebSocket) {
    const context = this.getOrCreateTopic(topic)
    context.subscribers.push([id, ws])
  }

  enqueueForPublish(topic: string, message: unknown) {
    const context = this.getOrCreateTopic(topic)
    // console.log('enqueueForPublish', topic, message)
    context.messages.push(message)
  }

  publishEnqueued(topic: string) {
    const context = this.getOrCreateTopic(topic)
    while (context.messages.length > 0) {
      const message = context.messages.shift()!
      for (const [id, ws] of context.subscribers) {
        // TODO: pre-serialize everything but the ID
        const update: ProtocolUpdateMessage = { type: 'update', id, data: message }
        ws.send(JSON.stringify(update))
      }
    }
    // prune subscribers that have disconnected
    context.subscribers = context.subscribers.filter(([_id, ws]) => ws.readyState === ws.OPEN)
  }

  publishAllEnqueued() {
    for (const topic of this.topics.keys()) {
      this.publishEnqueued(topic)
    }
  }
}
