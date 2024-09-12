import { logger } from '@'
import {
  type Decimal,
  type L2BookSnapshot,
  type L3BookSnapshot,
  type L3Order,
  Market,
  Product,
  Route,
  SymbologySnapshot,
  type TradeV1,
  Venue,
} from '@/architect'
import Big from 'big.js'
import { Connection } from '@solana/web3.js'
import * as Phoenix from '@ellipsis-labs/phoenix-sdk'
import { create } from 'superstruct'
import { TransactionSubscriptionNotification } from '../../types.ts'
import { RingBuffer } from '@/RingBuffer'
import { toNum } from '@ellipsis-labs/phoenix-sdk'
import BN from 'bn.js'
import type SubscriptionBroker from '../../SubscriptionBroker.ts'
import type { bignum } from '@metaplex-foundation/beet'

const TRACE_SLOT_DIFF = false

// const MARKET_PUBKEY = new PublicKey('4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg')
// const MARKET_PUBKEY = new PublicKey('9JXE9RZskL63ZySYo3xDPnqbhCbXHkLQH4E5Xh7UDekk')
// const MARKET_PUBKEY = new PublicKey('8BV6rrWsUabnTDA3dE6A69oUDJAj3hMhtBHTJyXB7czp')

export type PhoenixTrade = TradeV1 & {
  slot: number
  market_sequence_number: number
  taker_pubkey: string
}

export type PhoenixL3Order = L3Order & {
  order_sequence_number: number
  last_valid_slot?: number
  last_valid_unix_timestamp?: number
  maker_pubkey?: string
}

export default class ArchitectPhoenixConnector {
  phoenix: Phoenix.Client | null = null
  socket: WebSocket | null = null
  heliusApiKey: string
  broker: SubscriptionBroker
  // TODO: probably want to share symbology via snapshot merge with other connectors
  // and also shared index...
  symbology: SymbologySnapshot
  marketPubkeyToId: Map<string, string> = new Map()
  marketIdToPubkey: Map<string, string> = new Map()
  // pubkey => orderbook
  epoch: Date
  orderbooks: Map<string, PhoenixOrderbook> = new Map()

  protected constructor(heliusApiKey: string, broker: SubscriptionBroker) {
    this.heliusApiKey = heliusApiKey
    this.broker = broker
    this.symbology = new SymbologySnapshot()
    this.epoch = new Date()
  }

  static async create(
    solana: Connection,
    heliusApiKey: string,
    broker: SubscriptionBroker
  ): Promise<ArchitectPhoenixConnector> {
    const t = new ArchitectPhoenixConnector(heliusApiKey, broker)
    t.phoenix = await Phoenix.Client.create(solana)
    t.startListener()
    t.refreshSymbology()
    for (const [marketId, marketPubkey] of t.marketIdToPubkey.entries()) {
      t.orderbooks.set(marketPubkey, new PhoenixOrderbook(marketPubkey, marketId, t.epoch))
    }
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
    let lastSlot = 0
    this.socket = new WebSocket(`wss://atlas-mainnet.helius-rpc.com?api-key=${this.heliusApiKey}`)
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
              // accountInclude: [MARKET_PUBKEY.toString()],
              accountInclude: [Phoenix.PROGRAM_ID],
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
          const slot = res.params.result.slot
          if (slot != lastSlot) {
            logger.debug(`finished slot ${lastSlot}, now at ${slot}`)
            lastSlot = slot
          }
          const decoded = Phoenix.getPhoenixEventsFromTransactionData({
            ...res.params.result.transaction,
            slot,
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
    const newMarketIdToPubkey = new Map()
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
      newMarketIdToPubkey.set(market.id, pubkey)
    }
    newSymbology.epoch = this.symbology.epoch
    newSymbology.seqno = this.symbology.seqno + 1
    this.symbology = newSymbology
    this.marketPubkeyToId = newMarketPubkeyToId
    this.marketIdToPubkey = newMarketIdToPubkey
  }

  getL2Orderbook(marketId: string): L2BookSnapshot | null {
    const pubkey = this.marketIdToPubkey.get(marketId)
    if (!pubkey) {
      logger.warn(`no pubkey for market ${marketId}`)
      return null
    }
    const orderbook = this.orderbooks.get(pubkey)
    if (!orderbook) {
      logger.warn(`no orderbook for market ${marketId}`)
      return null
    }
    return orderbook.getL2Orderbook()
  }

  getL3Orderbook(marketId: string): L3BookSnapshot | null {
    const pubkey = this.marketIdToPubkey.get(marketId)
    if (!pubkey) {
      logger.warn(`no pubkey for market ${marketId}`)
      return null
    }
    const orderbook = this.orderbooks.get(pubkey)
    if (!orderbook) {
      logger.warn(`no orderbook for market ${marketId}`)
      return null
    }
    return orderbook.getL3Orderbook()
  }
}

type PhoenixOrder = {
  priceInTicks: number
  baseLots: number
  lastValidSlot?: number
  lastValidUnixTimestamp?: number
  makerPubkey?: string
}

function osnToDir(osn: bignum): 'Buy' | 'Sell' {
  return new BN(osn).shrn(63).isZero() ? 'Sell' : 'Buy'
}

class PhoenixOrderbook {
  marketId: string
  pubkey: string
  eventBuffer: RingBuffer<Phoenix.PhoenixEventsFromInstruction> = new RingBuffer(1000)
  synced: boolean = false
  state: Phoenix.MarketState | undefined
  epoch: Date
  msn: number | undefined
  // orderSequenceNumber.toString() => PhoenixOrder
  orders: Map<string, PhoenixOrder> = new Map()
  tradesChannel: string

  constructor(pubkey: string, marketId: string, epoch: Date) {
    this.marketId = marketId
    this.pubkey = pubkey
    this.epoch = epoch
    this.tradesChannel = `marketdata/trades/${marketId}`
  }

  getL2Orderbook() {
    if (!this.state) {
      return null
    }
    const bids: Map<number, number> = new Map()
    const asks: Map<number, number> = new Map()
    for (const [osn, order] of this.orders) {
      const msb = new BN(osn).shrn(63)
      const pit = order.priceInTicks
      const lot = order.baseLots
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
    const uiBidLevels: [Decimal, Decimal][] = bidLevels.map(([priceInTicks, baseLots]) => {
      const uiLevel = this.state!.levelToUiLevel(priceInTicks, baseLots)
      return [Big(uiLevel.price), Big(uiLevel.quantity)]
    })
    const uiAskLevels: [Decimal, Decimal][] = askLevels.map(([priceInTicks, baseLots]) => {
      const uiLevel = this.state!.levelToUiLevel(priceInTicks, baseLots)
      return [Big(uiLevel.price), Big(uiLevel.quantity)]
    })
    const snap: L2BookSnapshot = {
      timestamp: new Date(),
      epoch: this.epoch,
      seqno: this.msn!,
      bids: uiBidLevels,
      asks: uiAskLevels,
    }
    return snap
  }

  getL3Orderbook() {
    if (!this.state) {
      return null
    }
    const bids: PhoenixL3Order[] = []
    const asks: PhoenixL3Order[] = []
    for (const [osn, order] of this.orders) {
      const bosn = new BN(osn)
      const msb = bosn.shrn(63)
      const ul = this.state.levelToUiLevel(order.priceInTicks, order.baseLots)
      const l3Order: PhoenixL3Order = {
        order_sequence_number: (msb.isZero() ? bosn : bosn.notn(64)).toNumber(),
        price: Big(ul.price),
        size: Big(ul.quantity),
        last_valid_slot: order.lastValidSlot,
        last_valid_unix_timestamp: order.lastValidUnixTimestamp,
        maker_pubkey: order.makerPubkey,
      }
      if (msb.isZero()) {
        bids.push(l3Order)
      } else {
        asks.push(l3Order)
      }
    }
    // sort bids and asks by price, then order sequence number
    function compare(a: PhoenixL3Order, b: PhoenixL3Order) {
      return a.price.cmp(b.price) || a.order_sequence_number - b.order_sequence_number
    }
    bids.sort(compare)
    asks.sort(compare)
    const snap: L3BookSnapshot = {
      timestamp: new Date(),
      epoch: this.epoch,
      seqno: this.msn!,
      bids,
      asks,
    }
    return snap
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
    if (TRACE_SLOT_DIFF) {
      console.log('---')
      console.log('> snapshot')
      for (const [osn, o] of this.orders.entries()) {
        console.log(osn, o.priceInTicks, o.baseLots)
      }
    }
    this.synced = true
  }

  applyAndDrainEventBuffer(broker: SubscriptionBroker) {
    if (this.state === undefined || this.msn === undefined) {
      throw new Error('BUG: state or msn is undefined')
    }
    this.synced = false
    let lastSlot = 0
    let maxSlot = 0 // latest slot seen in event buffer
    let maxTsn = 0 // latest unix timestamp seen in event buffer
    let slotDiffBids: Map<number, number> = new Map() // priceInTicks => diff in base lots
    let slotDiffAsks: Map<number, number> = new Map()
    const state = this.state
    function printSlotDiff() {
      for (const [priceInTicks, diffBaseLots] of slotDiffBids.entries()) {
        const u = state.levelToUiLevel(priceInTicks, diffBaseLots)
        console.log('chg bid ', u.price, u.quantity)
      }
      for (const [priceInTicks, diffBaseLots] of slotDiffAsks.entries()) {
        const u = state.levelToUiLevel(priceInTicks, diffBaseLots)
        console.log('chg ask ', u.price, u.quantity)
      }
    }
    while (!this.eventBuffer.isEmpty()) {
      const ix = this.eventBuffer.removeFirst()
      const slot = toNum(ix.header.slot)
      if (TRACE_SLOT_DIFF) {
        if (slot != lastSlot) {
          console.log('---')
          console.log('> at slot', slot)
          printSlotDiff()
          slotDiffBids.clear()
          slotDiffAsks.clear()
        }
      }
      lastSlot = slot
      maxSlot = Math.max(maxSlot, slot)
      const sn = toNum(ix.header.sequenceNumber)
      const ts = new Date(toNum(ix.header.timestamp) * 1000)
      maxTsn = Math.max(maxTsn, toNum(ix.header.timestamp))
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
              // update orderbook
              const osn = f.orderSequenceNumber.toString()
              const priceInTicks = toNum(f.priceInTicks)
              const baseLotsFilled = toNum(f.baseLotsFilled)
              const baseLotsRemaining = toNum(f.baseLotsRemaining)
              if (TRACE_SLOT_DIFF) {
                console.log('fill', osn, priceInTicks, baseLotsFilled, baseLotsRemaining)
                if (osnToDir(f.orderSequenceNumber) == 'Buy') {
                  const entry = slotDiffBids.get(priceInTicks) ?? 0
                  slotDiffBids.set(priceInTicks, entry - baseLotsFilled)
                } else {
                  const entry = slotDiffAsks.get(priceInTicks) ?? 0
                  slotDiffAsks.set(priceInTicks, entry - baseLotsFilled)
                }
              }
              if (baseLotsRemaining <= 0) {
                if (!this.orders.has(osn)) {
                  logger.error(`fill for missing order ${osn}`)
                }
                this.orders.delete(osn)
              } else {
                const entry = this.orders.get(osn)
                if (entry) {
                  entry.baseLots = baseLotsRemaining
                } else {
                  logger.error(`partial fill for missing order ${osn}`)
                }
              }
              // publish trade
              const msb = new BN(f.orderSequenceNumber).shrn(63)
              const level = this.state.levelToUiLevel(
                toNum(f.priceInTicks),
                toNum(f.baseLotsFilled)
              )
              const trade: PhoenixTrade = {
                time: ts,
                slot,
                market_sequence_number: sn,
                // if resting order was ask (msb = 0), taker direction is buy
                direction: msb.isZero() ? 'Buy' : 'Sell',
                price: Big(level.price),
                size: Big(level.quantity),
                taker_pubkey: ix.header.signer.toString(),
              }
              logger.debug(`market=${this.marketId} trade=${JSON.stringify(trade)}`)
              broker.enqueueForPublish(this.tradesChannel, trade)
            }
            break
          case 'FillSummary':
            break
          case 'Fee':
            break
          case 'ExpiredOrder':
            for (const f of ev.fields) {
              const osn = f.orderSequenceNumber.toString()
              const priceInTicks = toNum(f.priceInTicks)
              const baseLotsRemoved = toNum(f.baseLotsRemoved)
              if (TRACE_SLOT_DIFF) {
                console.log('expired', osn, priceInTicks, baseLotsRemoved)
                const slotDiff =
                  osnToDir(f.orderSequenceNumber) == 'Buy' ? slotDiffBids : slotDiffAsks
                const slotEntry = slotDiff.get(priceInTicks) ?? 0
                slotDiff.set(priceInTicks, slotEntry - baseLotsRemoved)
              }
              const entry = this.orders.get(osn)
              if (
                entry &&
                (entry.priceInTicks != priceInTicks || entry.baseLots != baseLotsRemoved)
              ) {
                logger.error(
                  `mismatch: expected [${priceInTicks}, ${baseLotsRemoved}], but entry was ${entry}`
                )
              }
              this.orders.delete(osn)
            }
            break
          case 'Evict':
            for (const f of ev.fields) {
              const osn = f.orderSequenceNumber.toString()
              const priceInTicks = toNum(f.priceInTicks)
              const baseLotsEvicted = toNum(f.baseLotsEvicted)
              if (TRACE_SLOT_DIFF) {
                console.log('evict', osn, priceInTicks, baseLotsEvicted)
                const slotDiff =
                  osnToDir(f.orderSequenceNumber) == 'Buy' ? slotDiffBids : slotDiffAsks
                const slotEntry = slotDiff.get(priceInTicks) ?? 0
                slotDiff.set(priceInTicks, slotEntry - baseLotsEvicted)
              }
              const entry = this.orders.get(osn)
              if (
                entry &&
                (entry.priceInTicks != priceInTicks || entry.baseLots != baseLotsEvicted)
              ) {
                logger.error(
                  `mismatch: expected [${priceInTicks}, ${baseLotsEvicted}], but entry was ${entry}`
                )
              }
            }
            break
          case 'Header':
            break
          case 'Place':
            for (const f of ev.fields) {
              const osn = f.orderSequenceNumber.toString()
              const priceInTicks = toNum(f.priceInTicks)
              const baseLotsPlaced = toNum(f.baseLotsPlaced)
              if (TRACE_SLOT_DIFF) {
                console.log('place', osn, priceInTicks, baseLotsPlaced)
                const slotDiff =
                  osnToDir(f.orderSequenceNumber) == 'Buy' ? slotDiffBids : slotDiffAsks
                const slotEntry = slotDiff.get(priceInTicks) ?? 0
                slotDiff.set(priceInTicks, slotEntry + baseLotsPlaced)
              }
              if (baseLotsPlaced > 0) {
                this.orders.set(osn, {
                  priceInTicks,
                  baseLots: baseLotsPlaced,
                  makerPubkey: ix.header.signer.toString(),
                  // NB: lastValidSlot and lastValidTimestamp set on TimeInForce event
                })
              }
            }
            break
          case 'Reduce':
            for (const f of ev.fields) {
              const osn = f.orderSequenceNumber.toString()
              const priceInTicks = toNum(f.priceInTicks)
              const baseLotsRemaining = toNum(f.baseLotsRemaining)
              const baseLotsRemoved = toNum(f.baseLotsRemoved)
              if (TRACE_SLOT_DIFF) {
                console.log('reduce', osn, priceInTicks, baseLotsRemaining, baseLotsRemoved)
                const slotDiff =
                  osnToDir(f.orderSequenceNumber) == 'Buy' ? slotDiffBids : slotDiffAsks
                const slotEntry = slotDiff.get(priceInTicks) ?? 0
                slotDiff.set(priceInTicks, slotEntry - baseLotsRemoved)
              }
              const entry = this.orders.get(osn)
              if (
                entry &&
                (entry.priceInTicks != priceInTicks || entry.baseLots > baseLotsRemoved)
              ) {
                logger.error(
                  `mismatch: expected [${priceInTicks}, ${baseLotsRemoved}], but entry was ${entry}`
                )
              }
              if (baseLotsRemaining <= 0) {
                this.orders.delete(osn)
              } else if (entry) {
                entry.baseLots = baseLotsRemaining
              }
            }
            break
          case 'TimeInForce':
            for (const f of ev.fields) {
              const osn = f.orderSequenceNumber.toString()
              const entry = this.orders.get(osn)
              if (entry) {
                entry.lastValidSlot = toNum(f.lastValidSlot)
                entry.lastValidUnixTimestamp = toNum(f.lastValidUnixTimestampInSeconds)
              } else {
                logger.error(`TIF for unknown order ${osn}`)
              }
            }
            break
          case 'Uninitialized':
            break
        }
      }
      // prune orders that are past the latest tsn
      const pruneOsns = []
      for (const [osn, order] of this.orders) {
        if (order.lastValidUnixTimestamp && order.lastValidUnixTimestamp < maxTsn) {
          if (TRACE_SLOT_DIFF) {
            console.log('prune for ts', osn, order.lastValidUnixTimestamp, maxTsn)
          }
          pruneOsns.push(osn)
        }
        if (order.lastValidSlot && order.lastValidSlot < maxSlot) {
          if (TRACE_SLOT_DIFF) {
            console.log('prune for slot', osn, order.lastValidSlot, maxSlot)
          }
          pruneOsns.push(osn)
        }
      }
      for (const osn of pruneOsns) {
        if (TRACE_SLOT_DIFF) {
          const entry = this.orders.get(osn)
          if (entry) {
            const slotDiff = osnToDir(new BN(osn)) == 'Buy' ? slotDiffBids : slotDiffAsks
            const slotEntry = slotDiff.get(entry.priceInTicks) ?? 0
            slotDiff.set(entry.priceInTicks, slotEntry - entry.baseLots)
          }
        }
        this.orders.delete(osn)
      }
    }
    if (TRACE_SLOT_DIFF) {
      console.log('---')
      console.log('> post slot', lastSlot)
      printSlotDiff()
    }
    this.synced = true
  }
}
