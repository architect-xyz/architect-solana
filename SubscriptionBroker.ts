import type { ProtocolUpdateMessage } from '@/architect'
import type { ServerWebSocket } from 'bun'

type Context = {
  // [clientId, subId, ws]
  subscribers: [number, number, ServerWebSocket<any>][]
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

  subscribe(clientId: number, topic: string, id: number, ws: ServerWebSocket<any>) {
    const context = this.getOrCreateTopic(topic)
    context.subscribers.push([clientId, id, ws])
  }

  unsubscribe(clientId: number, topic: string, id: number) {
    const context = this.getOrCreateTopic(topic)
    context.subscribers = context.subscribers.filter(
      ([subClientId, subId, _]) => subClientId !== clientId || subId !== id
    )
  }

  unsubscribeAll(clientId: number, topic: string) {
    const context = this.getOrCreateTopic(topic)
    context.subscribers = context.subscribers.filter(
      ([subClientId, _subId, _]) => subClientId !== clientId
    )
  }

  unsubscribeClient(clientId: number) {
    for (const context of this.topics.values()) {
      context.subscribers = context.subscribers.filter(
        ([subClientId, _subId, _]) => subClientId !== clientId
      )
    }
  }

  enqueueForPublish(topic: string, message: unknown) {
    const context = this.getOrCreateTopic(topic)
    context.messages.push(message)
  }

  publishEnqueued(topic: string) {
    const context = this.getOrCreateTopic(topic)
    while (context.messages.length > 0) {
      const message = context.messages.shift()!
      for (const [_, id, ws] of context.subscribers) {
        // TODO: pre-serialize everything but the ID
        const update: ProtocolUpdateMessage = { type: 'update', id, data: message }
        ws.send(JSON.stringify(update))
      }
    }
    // prune subscribers that have disconnected
    context.subscribers = context.subscribers.filter(
      ([_, _id, ws]) => ws.readyState === WebSocket.OPEN
    )
  }

  publishAllEnqueued() {
    for (const topic of this.topics.keys()) {
      this.publishEnqueued(topic)
    }
  }
}
