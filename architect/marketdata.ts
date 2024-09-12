import { array, type Infer, number, object, optional, string, tuple } from 'superstruct'
import { DateTime, Decimal, Dir } from './common'

export const L1BookSnapshot = object({
  timestamp: DateTime,
  epoch: DateTime,
  seqno: number(),
  best_bid: optional(tuple([Decimal, Decimal])),
  best_ask: optional(tuple([Decimal, Decimal])),
})

export type L1BookSnapshot = Infer<typeof L1BookSnapshot>

export const L2BookSnapshot = object({
  timestamp: DateTime,
  epoch: DateTime,
  seqno: number(),
  bids: array(tuple([Decimal, Decimal])),
  asks: array(tuple([Decimal, Decimal])),
})

export type L2BookSnapshot = Infer<typeof L2BookSnapshot>

export const QueryL2BookSnapshot = object({
  market_id: string(),
})

export type QueryL2BookSnapshot = Infer<typeof QueryL2BookSnapshot>

export const L3Order = object({
  price: Decimal,
  size: Decimal,
})

export type L3Order = Infer<typeof L3Order>

export const L3BookSnapshot = object({
  timestamp: DateTime,
  epoch: DateTime,
  seqno: number(),
  bids: array(L3Order),
  asks: array(L3Order),
})

export type L3BookSnapshot = Infer<typeof L3BookSnapshot>

export const QueryL3BookSnapshot = object({
  market_id: string(),
})

export type QueryL3BookSnapshot = Infer<typeof QueryL3BookSnapshot>

export const TradeV1 = object({
  time: optional(DateTime),
  direction: optional(Dir),
  price: Decimal,
  size: Decimal,
})

export type TradeV1 = Infer<typeof TradeV1>
