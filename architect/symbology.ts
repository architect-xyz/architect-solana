import {
  array,
  boolean,
  coerce,
  type Infer,
  instance,
  literal,
  number,
  object,
  optional,
  record,
  string,
  union,
  unknown,
} from 'superstruct'
import * as uuid from 'uuid'
import { Decimal, DateTime } from './common'

// TODO: flip from Infer to Define, makes type hinting cleaner

const ROUTE_NS = uuid.parse('0cadbcc5-98bc-4888-94ba-fbbcb6f39132')

export class Route {
  static Struct = object({
    id: string(),
    name: string(),
  })

  id: string
  name: string

  constructor({ id, name }: Omit<Infer<typeof Route.Struct>, 'id'> & { id?: string }) {
    this.id = uuid.v5(name, ROUTE_NS)
    this.name = name
    if (id && id != this.id) {
      throw new Error(`while constructing Route, provided ID ${id} does not match ${name}`)
    }
  }
}

const VENUE_NS = uuid.parse('dd85a6c5-b45f-46d1-bf50-793dacb1e51a')

export class Venue {
  static Struct = object({
    id: string(),
    name: string(),
  })

  id: string
  name: string

  constructor({ id, name }: Omit<Infer<typeof Venue.Struct>, 'id'> & { id?: string }) {
    this.id = uuid.v5(name, VENUE_NS)
    this.name = name
    if (id && id != this.id) {
      throw new Error(`while constructing Venue, provided ID ${id} does not match ${name}`)
    }
  }
}

export const InstrumentType = union([
  object({
    type: literal('Inverse'),
  }),
  object({
    type: literal('Linear'),
  }),
  object({
    type: literal('Quanto'),
  }),
])

export type InstrumentType = Infer<typeof InstrumentType>

export const ProductKind = union([
  object({
    type: literal('Coin'),
    value: object({
      token_info: record(string(), unknown()),
    }),
  }),
  object({
    type: literal('Fiat'),
  }),
  object({
    type: literal('Equity'),
  }),
  object({
    type: literal('Perpetual'),
    value: object({
      underlying: optional(string()),
      multiplier: optional(Decimal),
      instrument_type: optional(InstrumentType),
    }),
  }),
  object({
    type: literal('Index'),
  }),
  object({
    type: literal('Commodity'),
  }),
])

export type ProductKind = Infer<typeof ProductKind>

const PRODUCT_NS = uuid.parse('bb25a7a7-a61c-485a-ac29-1de369a6a043')

export class Product {
  static Struct = object({
    id: string(),
    name: string(),
    kind: ProductKind,
  })

  id: string
  name: string
  kind: ProductKind

  constructor({ id, name, kind }: Omit<Infer<typeof Product.Struct>, 'id'> & { id?: string }) {
    this.id = uuid.v5(name, PRODUCT_NS)
    this.name = name
    this.kind = kind
    if (id && id != this.id) {
      throw new Error(`while constructing Product, provided ID ${id} does not match ${name}`)
    }
  }
}

export const MarketKind = union([
  object({
    type: literal('Exchange'),
    value: object({
      base: string(),
      quote: string(),
    }),
  }),
  object({
    type: literal('Pool'),
    value: object({
      products: array(string()),
    }),
  }),
  object({
    type: literal('Unknown'),
  }),
])

export type MarketKind = Infer<typeof MarketKind>

export const MarketInfo = union([
  object({
    type: literal('External'),
    value: object({
      tick_size: Decimal,
      step_size: Decimal,
      min_order_quantity: Decimal,
      min_order_quantity_unit: union([literal('Base'), literal('Quote')]),
      is_delisted: boolean(),
    }),
  }),
])

export type MarketInfo = Infer<typeof MarketInfo>

const MARKET_NS = uuid.parse('0bfe858c-a749-43a9-a99e-6d1f31a760ad')

export class Market {
  static Struct = object({
    id: string(),
    name: string(),
    kind: MarketKind,
    venue: string(),
    route: string(),
    exchange_symbol: string(),
    extra_info: MarketInfo,
  })

  id: string
  name: string
  kind: MarketKind
  venue: string
  route: string
  exchange_symbol: string
  extra_info: MarketInfo

  constructor({
    id,
    name,
    kind,
    base,
    quote,
    venue,
    route,
    exchange_symbol,
    extra_info,
  }: {
    id?: string
    name: string
    kind?: MarketKind
    base?: Product
    quote?: Product
    venue: string | Venue
    route: string | Route
    exchange_symbol: string
    extra_info: MarketInfo
  }) {
    this.id = uuid.v5(name, MARKET_NS)
    this.name = name
    if (kind) {
      this.kind = kind
    } else if (base && quote) {
      this.kind = {
        type: 'Exchange',
        value: {
          base: base.id,
          quote: quote.id,
        },
      }
    } else {
      throw new Error(`while constructing Market, must provide kind, or base and quote`)
    }
    if (typeof venue === 'string') {
      this.venue = venue
    } else {
      this.venue = venue.id
    }
    if (typeof route === 'string') {
      this.route = route
    } else {
      this.route = route.id
    }
    this.exchange_symbol = exchange_symbol
    this.extra_info = extra_info
    if (id && id != this.id) {
      throw new Error(`while constructing Market, provided ID ${id} does not match ${name}`)
    }
  }
}

export class SymbologySnapshot {
  static Struct = object({
    epoch: DateTime,
    seqno: number(),
    routes: array(coerce(instance(Route), Route.Struct, (value) => new Route(value))),
    venues: array(coerce(instance(Venue), Venue.Struct, (value) => new Venue(value))),
    products: array(coerce(instance(Product), Product.Struct, (value) => new Product(value))),
    markets: array(coerce(instance(Market), Market.Struct, (value) => new Market(value))),
  })

  epoch: Date
  seqno: number = 0
  routes: Route[] = []
  venues: Venue[] = []
  products: Product[] = []
  markets: Market[] = []

  constructor(args?: Infer<typeof SymbologySnapshot.Struct>) {
    if (args !== undefined) {
      this.epoch = args.epoch
      this.seqno = args.seqno
      this.routes = args.routes
      this.venues = args.venues
      this.products = args.products
      this.markets = args.markets
    } else {
      this.epoch = new Date()
    }
  }
}
