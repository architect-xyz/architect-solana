import { array, type Infer, number, object, optional, string, tuple } from 'superstruct'
import { DateTime, Decimal, Dir } from './common.ts'

export const L2BookSnapshot = object({
  timestamp: DateTime,
  seqno: number(),
  bids: array(tuple([Decimal, Decimal])),
  asks: array(tuple([Decimal, Decimal])),
})

export type L2BookSnapshot = Infer<typeof L2BookSnapshot>

export const QueryL2BookSnapshot = object({
  market_id: string(),
})

export type QueryL2BookSnapshot = Infer<typeof QueryL2BookSnapshot>

export const TradeV2 = object({
  time: optional(DateTime),
  direction: Dir,
  price: Decimal,
  size: Decimal,
})

export type TradeV2 = Infer<typeof TradeV2>
