import 'dotenv/config'
import pino from 'pino'
import { parseArgs } from 'util'
import { create } from 'superstruct'
import { Connection, PublicKey } from '@solana/web3.js'
import * as Phoenix from '@ellipsis-labs/phoenix-sdk'
import type { bignum } from '@metaplex-foundation/beet'
import BN from 'bn.js'
import { toNum } from '@ellipsis-labs/phoenix-sdk'
import { RingBuffer } from './RingBuffer.ts'
import { TransactionSubscriptionNotification } from './types.ts'
import { ProtocolMessage, QueryL2BookSnapshot } from './architect'
import ArchitectPhoenixConnector from './connectors/phoenix'
import SubscriptionBroker from './SubscriptionBroker.ts'

const WSS_ENDPOINT = process.env['WSS_ENDPOINT']!
const HTTP_ENDPOINT = process.env['HTTP_ENDPOINT']!
const HELIUS_API_KEY = process.env['HELIUS_API_KEY']!
const MARKET_PUBKEY = new PublicKey('4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg')

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

const solana = new Connection(HTTP_ENDPOINT, { wsEndpoint: WSS_ENDPOINT })
const phoenix = await ArchitectPhoenixConnector.create(solana, HELIUS_API_KEY, broker)

const BUFFER: RingBuffer<Phoenix.PhoenixEventsFromInstruction> = new RingBuffer(1000)
let SYNCED = false
let STATE: Phoenix.MarketState
let ORDERS: Map<string, [bignum, bignum]> = new Map() // orderSequenceNumber.toString() => [priceInTicks, baseLots]

function printOrderBook() {
  const marketAddress = MARKET_PUBKEY.toString()
  const bids: Map<number, number> = new Map()
  const asks: Map<number, number> = new Map()
  for (const [osn, [priceInTicks, baseLots]] of ORDERS) {
    const msb = new BN(osn).shrn(63)
    const pit = toNum(priceInTicks)
    const lot = toNum(baseLots)
    if (msb.isZero()) {
      const existing = asks.get(pit)
      asks.set(pit, existing ? existing + lot : lot)
    } else {
      const existing = bids.get(pit)
      bids.set(pit, existing ? existing + lot : lot)
    }
  }
  const bidLevels = Array.from(bids.entries()).sort((a, b) => b[0] - a[0])
  const askLevels = Array.from(asks.entries()).sort((a, b) => a[0] - b[0])
  const uiBidLevels = bidLevels.map(([priceInTicks, baseLots]) => {
    const uiLevel = STATE.levelToUiLevel(priceInTicks, baseLots)
    return [uiLevel.price, uiLevel.quantity]
  })
  const uiAskLevels = askLevels.map(([priceInTicks, baseLots]) => {
    const uiLevel = STATE.levelToUiLevel(priceInTicks, baseLots)
    return [uiLevel.price, uiLevel.quantity]
  })
  // print the top 5 levels
  console.log(`Market: ${marketAddress}`)
  const fmt = (x: number) => x.toFixed(4).padStart(8)
  for (let i = 0; i < 5; i++) {
    const bid = uiBidLevels[i] ?? [0, 0]
    const ask = uiAskLevels[i] ?? [0, 0]
    console.log(`${fmt(bid[1])} : ${fmt(bid[0])} | ${fmt(ask[0])} : ${fmt(ask[1])}`)
  }
  console.log('')
}

function streamMarketEvents() {
  const socket = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${HELIUS_API_KEY}`)

  socket.addEventListener('open', () => {
    console.log('Connection opened')
    socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 420,
        method: 'transactionSubscribe',
        params: [
          {
            vote: false,
            failed: false,
            accountInclude: [MARKET_PUBKEY.toString()],
            // accountInclude: [Phoenix.PROGRAM_ID],
          },
          {
            commitment: 'confirmed',
            encoding: 'jsonParsed',
            transaction_details: 'full',
            showRewards: true,
            maxSupportedTransactionVersion: 0,
          },
        ],
      })
    )
  })

  socket.addEventListener('close', () => {
    console.log('Connection closed')
  })

  socket.addEventListener('error', (event) => {
    console.error('Connection error: ', event)
  })

  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const unsafeRes = JSON.parse(event.data)
      const res = create(unsafeRes, TransactionSubscriptionNotification)
      if ('params' in res && res.params.result) {
        const decoded = Phoenix.getPhoenixEventsFromTransactionData({
          ...res.params.result.transaction,
          slot: res.params.result.slot,
        })
        for (const ix of decoded.instructions) {
          if (ix.header.market.equals(MARKET_PUBKEY)) {
            BUFFER.add(ix)
          }
        }
        if (SYNCED) {
          applyMarketUpdates()
        } else {
          console.log(`buffered: ${BUFFER.getBufferLength()}`)
        }
        // for (const ix of decoded.instructions) {
        //   console.log(
        //     `slot: ${ix.header.slot} | market: ${ix.header.market} | sn: ${ix.header.sequenceNumber} $`
        //   )
        // }
      }
    }
  })
}

// function applyMarketUpdates() {
//   SYNCED = false
//   while (!BUFFER.isEmpty()) {
//     const ix = BUFFER.removeFirst()
//     if (lte(ix.header.sequenceNumber, MSN)) {
//       continue
//     }
//     const MSN_PLUS_ONE = new BN(MSN).addn(1)
//     if (!eq(ix.header.sequenceNumber, MSN_PLUS_ONE)) {
//       // gap, need to resync
//       throw new Error(`gap detected: expected ${MSN_PLUS_ONE}, got ${ix.header.sequenceNumber}`)
//     }
//     MSN = ix.header.sequenceNumber
//     for (const ev of ix.events) {
//       switch (ev.__kind) {
//         case 'Fill':
//           for (const f of ev.fields) {
//             // console.log(
//             //   ` ->FILL ${f.orderSequenceNumber} baseLots=${f.baseLotsFilled} price=${f.priceInTicks}`
//             // )
//             const osn = f.orderSequenceNumber.toString()
//             if (eq(f.baseLotsRemaining, 0)) {
//               ORDERS.delete(osn)
//             } else {
//               ORDERS.set(osn, [f.priceInTicks, f.baseLotsRemaining])
//             }
//           }
//           break
//         case 'FillSummary':
//           break
//         case 'Fee':
//           break
//         case 'ExpiredOrder':
//           for (const f of ev.fields) {
//             // console.log(
//             //   ` ->EXPIRE ${f.orderSequenceNumber} baseLots=${f.baseLotsRemoved} price=${f.priceInTicks}`
//             // )
//             const osn = f.orderSequenceNumber.toString()
//             const entry = ORDERS.get(osn)
//             if (entry) {
//               const [priceInTicks, baseLots] = entry
//               if (!eq(priceInTicks, f.priceInTicks) || !eq(baseLots, f.baseLotsRemoved)) {
//                 const expected = [f.priceInTicks, f.baseLotsRemoved]
//                 console.error(` ! mismatch: expected [${expected}], $[, but entry was ${entry}`)
//               }
//             }
//             ORDERS.delete(osn)
//           }
//           break
//         case 'Evict':
//           for (const f of ev.fields) {
//             // console.log(
//             //   ` ->EVICT ${f.orderSequenceNumber} baseLots=${f.baseLotsEvicted} price=${f.priceInTicks}`
//             // )
//             const osn = f.orderSequenceNumber.toString()
//             const entry = ORDERS.get(osn)
//             if (entry) {
//               const [priceInTicks, baseLots] = entry
//               if (!eq(priceInTicks, f.priceInTicks) || !eq(baseLots, f.baseLotsEvicted)) {
//                 const expected = [f.priceInTicks, f.baseLotsEvicted]
//                 console.error(` ! mismatch: expected [${expected}], $[, but entry was ${entry}`)
//               }
//             }
//             ORDERS.delete(osn)
//           }
//           break
//         case 'Header':
//           break
//         case 'Place':
//           for (const f of ev.fields) {
//             // console.log(
//             //   ` ->PLACE ${f.orderSequenceNumber} baseLots=${f.baseLotsPlaced} price=${f.priceInTicks}`
//             // )
//             const osn = f.orderSequenceNumber.toString()
//             if (!eq(f.baseLotsPlaced, 0)) {
//               ORDERS.set(osn, [f.priceInTicks, f.baseLotsPlaced])
//             }
//           }
//           break
//         case 'Reduce':
//           for (const f of ev.fields) {
//             // console.log(
//             //   ` ->REDUCE ${f.orderSequenceNumber} baseLots=${f.baseLotsRemoved} price=${f.priceInTicks}`
//             // )
//             const osn = f.orderSequenceNumber.toString()
//             const entry = ORDERS.get(osn)
//             if (entry) {
//               const [priceInTicks, baseLots] = entry
//               if (!eq(priceInTicks, f.priceInTicks) || !eq(baseLots, f.baseLotsRemoved)) {
//                 const expected = [f.priceInTicks, f.baseLotsRemoved]
//                 console.error(` ! mismatch: expected [${expected}], but entry was ${entry}`)
//               }
//             }
//             if (eq(f.baseLotsRemaining, 0)) {
//               ORDERS.delete(osn)
//             } else {
//               ORDERS.set(osn, [f.priceInTicks, f.baseLotsRemaining])
//             }
//           }
//           break
//         case 'TimeInForce':
//           break
//         case 'Uninitialized':
//           break
//       }
//     }
//   }
//   printOrderBook()
//   SYNCED = true
// }

// streamMarketEvents()
// setTimeout(syncMarket, 1000)

const port = parseInt(args.values.port ?? '8888')

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
