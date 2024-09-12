import 'dotenv/config'
import pino from 'pino'
import * as Sentry from '@sentry/bun'
import { parseArgs } from 'util'
import { create } from 'superstruct'
import { Connection } from '@solana/web3.js'
import * as Architect from './architect'
import { QueryL2BookSnapshot, QueryL3BookSnapshot } from './architect'
import ArchitectPhoenixConnector from './connectors/phoenix'
import SubscriptionBroker from './SubscriptionBroker.ts'

const WSS_ENDPOINT = process.env['WSS_ENDPOINT']!
const HTTP_ENDPOINT = process.env['HTTP_ENDPOINT']!
const HELIUS_API_KEY = process.env['HELIUS_API_KEY']!

// set variables SENTRY_DSN, SENTRY_ENVIRONMENT
Sentry.init({ tracesSampleRate: 1.0 })

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
  transport: {
    target: 'pino-pretty',
  },
})

const broker = new SubscriptionBroker()
const port = parseInt(args.values.port ?? '8888')
const architect = new Architect.Server(args.values.host ?? 'localhost', port, broker)

const solana = new Connection(HTTP_ENDPOINT, { wsEndpoint: WSS_ENDPOINT })
const phoenix = await ArchitectPhoenixConnector.create(solana, HELIUS_API_KEY, broker)

architect.rpc('symbology/snapshot', () => ({ result: phoenix.symbology }))

architect.rpc('marketdata/book/l2/snapshot', (params) => {
  const parsed = create(params, QueryL2BookSnapshot)
  const snapshot = phoenix.getL2Orderbook(parsed.market_id)
  if (snapshot !== null) {
    return { result: snapshot }
  } else {
    return { error: { code: -32000, message: 'orderbook snapshot not found' } }
  }
})

architect.rpc('marketdata/book/l3/snapshot', (params) => {
  const parsed = create(params, QueryL3BookSnapshot)
  const snapshot = phoenix.getL3Orderbook(parsed.market_id)
  if (snapshot !== null) {
    return { result: snapshot }
  } else {
    return { error: { code: -32000, message: 'orderbook snapshot not found' } }
  }
})

logger.info(`listening on ${args.values.host}:${port}...`)
architect.serve()
