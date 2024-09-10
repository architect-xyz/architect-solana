import { create } from 'superstruct'
import { ProtocolMessage } from './protocol.ts'
import { logger } from '@'
import type SubscriptionBroker from '../SubscriptionBroker.ts'

type RpcResult =
  | {
      result: unknown
    }
  | {
      error: {
        code: number
        message: string
      }
    }

type RpcHandler = (params: unknown) => RpcResult

export class Server {
  host: string
  port: number
  nextClientId: number = 1
  server: any = null // TODO: what type is this?
  broker: SubscriptionBroker
  handlers: Record<string, RpcHandler> = {}

  constructor(host: string, port: number, broker: SubscriptionBroker) {
    this.host = host
    this.port = port
    this.broker = broker
  }

  serve() {
    const self = this
    this.server = Bun.serve<{ clientId: number }>({
      hostname: this.host,
      port: this.port,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        const clientId = self.nextClientId
        self.nextClientId += 1
        if (
          server.upgrade(req, {
            data: {
              clientId,
            },
          })
        ) {
          return // do not return a Response
        }
        return new Response('Upgrade failed', { status: 500 })
      },
      websocket: {
        message(ws, message) {
          if (typeof message !== 'string') {
            return
          }
          try {
            const unsafeJson = JSON.parse(message)
            const parsed = create(unsafeJson, ProtocolMessage)
            if (parsed.type == 'subscribe') {
              logger.info(`received subscribe: ${parsed.topic}`)
              ws.send(
                JSON.stringify({
                  type: 'response',
                  id: parsed.id,
                  result: parsed.id,
                })
              )
              self.broker.subscribe(ws.data.clientId, parsed.topic, parsed.id, ws)
            } else if (parsed.type == 'unsubscribe') {
              ws.send(
                JSON.stringify({
                  type: 'response',
                  id: parsed.id,
                  result: parsed.id,
                })
              )
              if (parsed.sub_id !== undefined) {
                self.broker.unsubscribe(ws.data.clientId, parsed.topic, parsed.sub_id)
              } else {
                self.broker.unsubscribeAll(ws.data.clientId, parsed.topic)
              }
            } else if (parsed.type == 'query') {
              logger.info(`received query: ${parsed.method}`)
              if (self.handlers[parsed.method] !== undefined) {
                try {
                  const res = self.handlers[parsed.method](parsed.params)
                  ws.send(
                    JSON.stringify({
                      type: 'response',
                      id: parsed.id,
                      ...res,
                    })
                  )
                } catch (e) {
                  logger.error(`while handling rpc: ${e}`)
                  ws.send(
                    JSON.stringify({
                      type: 'response',
                      id: parsed.id,
                      error: { code: -32000, message: 'internal error' },
                    })
                  )
                }
              } else {
                ws.send(
                  JSON.stringify({
                    type: 'response',
                    id: parsed.id,
                    error: { code: -32601, message: 'method not found' },
                  })
                )
              }
            }
          } catch (err) {
            logger.error(`while handling ws message: ${err}`)
          }
        },
      },
    })
  }

  rpc(method: string, handler: RpcHandler) {
    this.handlers[method] = handler
  }
}
