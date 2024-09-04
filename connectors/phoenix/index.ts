import { logger } from '@'
import { Market, Product, Route, SymbologySnapshot, type TradeV2, Venue } from '@/architect'
import Big from 'big.js'
import { Connection, PublicKey } from '@solana/web3.js'
import * as Phoenix from '@ellipsis-labs/phoenix-sdk'
import { create } from 'superstruct'
import { TransactionSubscriptionNotification } from '../../types.ts'
import { RingBuffer } from '@/RingBuffer'
import { toNum } from '@ellipsis-labs/phoenix-sdk'
import BN from 'bn.js'
import type SubscriptionBroker from '../../SubscriptionBroker.ts'

const MARKET_PUBKEY = new PublicKey('4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg')

export type PhoenixTradeV2 = TradeV2 & { slot: number; market_sequence_number: number }

export default class ArchitectPhoenixConnector {
  phoenix: Phoenix.Client | null = null
  socket: WebSocket | null = null
  helius_api_key: string
  broker: SubscriptionBroker
  // TODO: probably want to share symbology via snapshot merge with other connectors
  // and also shared index...
  symbology: SymbologySnapshot
  marketPubkeyToId: Map<string, string> = new Map()
  orderbooks: Map<string, PhoenixOrderbook> = new Map()

  protected constructor(helius_api_key: string, broker: SubscriptionBroker) {
    this.helius_api_key = helius_api_key
    this.broker = broker
    this.symbology = new SymbologySnapshot()
  }

  static async create(
    solana: Connection,
    helius_api_key: string,
    broker: SubscriptionBroker
  ): Promise<ArchitectPhoenixConnector> {
    const t = new ArchitectPhoenixConnector(helius_api_key, broker)
    t.phoenix = await Phoenix.Client.create(solana)
    t.startListener()
    t.refreshSymbology()
    const marketPubkey = MARKET_PUBKEY.toString()
    const MARKET_ID = t.marketPubkeyToId.get(marketPubkey)!
    t.orderbooks.set(marketPubkey, new PhoenixOrderbook(marketPubkey, MARKET_ID))
    setTimeout(() => {
      ;(async function () {
        logger.info('snapshot refresh all markets...')
        const phoenix = t.phoenix!
        await phoenix.refreshAllMarkets()
        for (const orderbook of t.orderbooks.values()) {
          orderbook.sync(phoenix)
        }
        logger.info('finished snapshot refresh all markets')
      })().catch((e) => {
        logger.error('error in Phoenix connector', e)
      })
    }, 1000)
    return t
  }

  startListener() {
    logger.info('Starting Helius websocket')
    const broker = this.broker
    this.socket = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${this.helius_api_key}`)
    this.socket.addEventListener('open', () => {
      logger.info('Helius websocket connected')
      this.socket?.send(
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
    this.socket.addEventListener('close', () => {
      logger.error('Helius websocket closed, restarting in 5s...')
      setTimeout(() => {
        this.startListener()
      }, 5000)
    })
    this.socket.addEventListener('error', (event) => {
      logger.error('Helius websocket error', event)
    })
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        const unsafeRes = JSON.parse(event.data)
        const res = create(unsafeRes, TransactionSubscriptionNotification)
        if ('params' in res && res.params.result) {
          const decoded = Phoenix.getPhoenixEventsFromTransactionData({
            ...res.params.result.transaction,
            slot: res.params.result.slot,
          })
          for (const ix of decoded.instructions) {
            const pubkey = ix.header.market.toString()
            const orderbook = this.orderbooks.get(pubkey)
            if (orderbook) {
              orderbook.eventBuffer.add(ix)
            }
          }
          for (const orderbook of this.orderbooks.values()) {
            if (orderbook.synced) {
              orderbook.applyAndDrainEventBuffer(broker)
            }
          }
          broker.publishAllEnqueued()
        }
      }
    })
  }

  /// Refresh the symbology snapshot from the Phoenix client
  refreshSymbology() {
    if (!this.phoenix) {
      return
    }
    const newMarketPubkeyToId = new Map()
    const newSymbology = new SymbologySnapshot()
    const route = new Route({ name: 'DIRECT' })
    const venue = new Venue({ name: 'PHOENIX' })
    newSymbology.routes.push(route)
    newSymbology.venues.push(venue)
    for (const [pubkey, config] of this.phoenix.marketConfigs) {
      // TODO: configurable symbology remaps e.g. $WIF -> WIF, Bonk -> BONK
      let baseSymbol = config.baseToken.symbol
      if (baseSymbol == '$WIF') {
        baseSymbol = 'WIF'
      } else if (baseSymbol == 'Bonk') {
        baseSymbol = 'BONK'
      }
      const base = new Product({
        name: `${baseSymbol} Crypto`,
        kind: { type: 'Coin', value: { token_info: {} } },
      })
      const quote = new Product({
        name: `${config.quoteToken.symbol} Crypto`,
        kind: { type: 'Coin', value: { token_info: {} } },
      })
      newSymbology.products.push(base)
      newSymbology.products.push(quote)
      let meta = this.phoenix.marketMetadatas.get(pubkey)
      if (!meta) {
        logger.warn(`no metadata for market ${pubkey}, skipping`)
      }
      meta = meta!
      const tickSize = Big(meta.quoteAtomsToQuoteUnits(meta.tickSizeInQuoteAtomsPerBaseUnit))
      const stepSize = Big(meta.baseAtomsToRawBaseUnits(meta.baseLotSize))
      const market = new Market({
        name: `${base.name}/${quote.name}*PHOENIX/DIRECT`,
        base,
        quote,
        venue,
        route,
        exchange_symbol: pubkey,
        extra_info: {
          type: 'External',
          value: {
            tick_size: tickSize,
            step_size: stepSize,
            min_order_quantity: stepSize,
            min_order_quantity_unit: 'Base',
            is_delisted: false,
          },
        },
      })
      newSymbology.markets.push(market)
      newMarketPubkeyToId.set(pubkey, market.id)
    }
    newSymbology.epoch = this.symbology.epoch
    newSymbology.seqno = this.symbology.seqno + 1
    this.symbology = newSymbology
    this.marketPubkeyToId = newMarketPubkeyToId
  }
}

type PhoenixOrder = {
  priceInTicks: number
  baseLots: number
  lastValidSlot: number
  lastValidUnixTimestamp: number
  makerPubkey?: string | null
}

class PhoenixOrderbook {
  marketId: string
  pubkey: string
  eventBuffer: RingBuffer<Phoenix.PhoenixEventsFromInstruction> = new RingBuffer(1000)
  synced: boolean = false
  state: Phoenix.MarketState | undefined
  msn: number | undefined
  // orderSequenceNumber.toString() => [priceInTicks, baseLots]
  orders: Map<string, PhoenixOrder> = new Map()
  tradesChannel: string

  constructor(pubkey: string, marketId: string) {
    this.marketId = marketId
    this.pubkey = pubkey
    this.tradesChannel = `marketdata/trades/${marketId}`
  }

  sync(phoenix: Phoenix.Client) {
    this.synced = false
    const state = phoenix.marketStates.get(this.pubkey)
    if (!state) {
      throw new Error(`no market state ${this.pubkey}`)
    }
    this.state = state
    this.msn = toNum(state.data.header.marketSequenceNumber)
    this.orders.clear()
    for (const [oid, order] of state.data.bids) {
      const osn = oid.orderSequenceNumber.toString()
      this.orders.set(osn, {
        priceInTicks: toNum(oid.priceInTicks),
        baseLots: toNum(order.numBaseLots),
        lastValidSlot: toNum(order.lastValidSlot),
        lastValidUnixTimestamp: toNum(order.lastValidUnixTimestampInSeconds),
        makerPubkey: state.data.traderIndexToTraderPubkey.get(toNum(order.traderIndex)),
      })
    }
    for (const [oid, order] of state.data.asks) {
      const osn = oid.orderSequenceNumber.toString()
      this.orders.set(osn, {
        priceInTicks: toNum(oid.priceInTicks),
        baseLots: toNum(order.numBaseLots),
        lastValidSlot: toNum(order.lastValidSlot),
        lastValidUnixTimestamp: toNum(order.lastValidUnixTimestampInSeconds),
        makerPubkey: state.data.traderIndexToTraderPubkey.get(toNum(order.traderIndex)),
      })
    }
    this.synced = true
  }

  applyAndDrainEventBuffer(broker: SubscriptionBroker) {
    if (this.state === undefined || this.msn === undefined) {
      throw new Error('BUG: state or msn is undefined')
    }
    this.synced = false
    while (!this.eventBuffer.isEmpty()) {
      const ix = this.eventBuffer.removeFirst()
      const slot = toNum(ix.header.slot)
      const sn = toNum(ix.header.sequenceNumber)
      const ts = new Date(toNum(ix.header.timestamp) * 1000)
      if (sn <= this.msn) {
        continue
      }
      const msnPlusOne = this.msn + 1
      if (sn != this.msn + 1) {
        throw new Error(`gap detected: expected ${msnPlusOne}, got ${sn}`)
      }
      this.msn = sn
      for (const ev of ix.events) {
        switch (ev.__kind) {
          case 'Fill':
            for (const f of ev.fields) {
              const msb = new BN(f.orderSequenceNumber).shrn(63)
              const level = this.state.levelToUiLevel(
                toNum(f.priceInTicks),
                toNum(f.baseLotsFilled)
              )
              const trade: PhoenixTradeV2 = {
                time: ts,
                slot,
                market_sequence_number: sn,
                // if resting order was ask (msb = 0), taker direction is buy
                direction: msb.isZero() ? 'Buy' : 'Sell',
                price: Big(level.price),
                size: Big(level.quantity),
              }
              broker.enqueueForPublish(this.tradesChannel, trade)
            }
            break
        }
      }
    }
    this.synced = true
  }
}
