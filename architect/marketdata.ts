import { array, type Infer, number, object, optional, string, tuple } from 'superstruct'
import { DateTime, Decimal, Dir } from './common.ts'

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

export const TradeV1 = object({
  time: optional(DateTime),
  direction: optional(Dir),
  price: Decimal,
  size: Decimal,
})

export type TradeV1 = Infer<typeof TradeV1>
