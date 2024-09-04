import { coerce, date, type Infer, instance, literal, string, union } from 'superstruct'
import Big from 'big.js'

export const DateTime = coerce(date(), string(), (value) => new Date(value))

export type DateTime = Infer<typeof DateTime>

export const Decimal = coerce(instance(Big), string(), (value) => Big(value))

export type Decimal = Infer<typeof Decimal>

export const Dir = union([literal('Buy'), literal('Sell')])

export type Dir = Infer<typeof Dir>
