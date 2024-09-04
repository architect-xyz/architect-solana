import 'dotenv/config'
import pino from 'pino'
import { parseArgs } from 'util'
import { create } from 'superstruct'
import { Connection, PublicKey } from '@solana/web3.js'
import { ProtocolMessage, QueryL2BookSnapshot } from './architect'
import ArchitectPhoenixConnector from './connectors/phoenix'
import SubscriptionBroker from './SubscriptionBroker.ts'

const WSS_ENDPOINT = process.env['WSS_ENDPOINT']!
const HTTP_ENDPOINT = process.env['HTTP_ENDPOINT']!
const HELIUS_API_KEY = process.env['HELIUS_API_KEY']!

const args = parseArgs({
  args: Bun.argv,
  options: {
    host: { type: 'string', short: 'h', default: 'localhost' },
    port: { type: 'string', short: 'p', default: '8888' },
  },
  allowPositionals: true,
})

export const logger = pino({
  name: 'architect-solana',
  level: 'debug',
  // TODO: only for dev
  transport: {
    target: 'pino-pretty',
  },
})

const broker = new SubscriptionBroker()
const port = parseInt(args.values.port ?? '8888')

const solana = new Connection(HTTP_ENDPOINT, { wsEndpoint: WSS_ENDPOINT })
const phoenix = await ArchitectPhoenixConnector.create(solana, HELIUS_API_KEY, broker)

logger.info(`listening on ${args.values.host}:${port}...`)

Bun.serve({
  hostname: args.values.host,
  port: parseInt(args.values.port ?? '8888'),
  fetch(req, server) {
    // upgrade the request to a WebSocket
    if (server.upgrade(req)) {
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
        if (parsed.type == 'query') {
          logger.info(`received query: ${parsed.method}`)
          switch (parsed.method) {
            case 'symbology/snapshot':
              ws.send(
                JSON.stringify({
                  type: 'response',
                  id: parsed.id,
                  result: phoenix.symbology,
                })
              )
              break
            case 'marketdata/book/l2/snapshot':
              const params = create(parsed.params, QueryL2BookSnapshot)
              const snapshot = phoenix.getL2Orderbook(params.market_id)
              if (snapshot !== null) {
                ws.send(
                  JSON.stringify({
                    type: 'response',
                    id: parsed.id,
                    result: snapshot,
                  })
                )
              } else {
                ws.send(
                  JSON.stringify({
                    type: 'response',
                    id: parsed.id,
                    error: { code: -32000, message: 'orderbook snapshot not found' },
                  })
                )
              }
              break
            default:
              ws.send(
                JSON.stringify({
                  type: 'response',
                  id: parsed.id,
                  error: { code: -32601, message: 'method not found' },
                })
              )
              break
          }
        }
      } catch (err) {
        logger.error(`while handling ws message: ${err}`)
      }
    },
  },
})
