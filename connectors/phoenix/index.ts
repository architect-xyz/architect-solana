import { logger } from '@'
import { Market, Product, Route, SymbologySnapshot, Venue } from '@/architect'
import Big from 'big.js'
import { Connection } from '@solana/web3.js'
import * as Phoenix from '@ellipsis-labs/phoenix-sdk'

export default class ArchitectPhoenixConnector {
  phoenix: Phoenix.Client | null = null
  // TODO: probably want to share symbology via snapshot merge with other connectors
  // and also shared index...
  symbology: SymbologySnapshot

  protected constructor() {
    this.symbology = new SymbologySnapshot()
  }

  static async create(solana: Connection): Promise<ArchitectPhoenixConnector> {
    const t = new ArchitectPhoenixConnector()
    t.phoenix = await Phoenix.Client.create(solana)
    t.refreshSymbology()
    return t
  }

  /// Refresh the symbology snapshot from the Phoenix client
  refreshSymbology() {
    if (!this.phoenix) {
      return
    }
    const newSymbology = new SymbologySnapshot()
    const route = new Route({ name: 'DIRECT' })
    const venue = new Venue({ name: 'PHOENIX' })
    newSymbology.routes.push(route)
    newSymbology.venues.push(venue)
    for (const [pubkey, config] of this.phoenix.marketConfigs) {
      const base = new Product({
        name: `${config.baseToken.name} Crypto`,
        kind: { type: 'Coin', value: { token_info: {} } },
      })
      const quote = new Product({
        name: `${config.quoteToken.name} Crypto`,
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
        name: `${config.baseToken.name}/${config.quoteToken.name}*PHOENIX/DIRECT`,
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
    }
    newSymbology.epoch = this.symbology.epoch
    newSymbology.seqno = this.symbology.seqno + 1
    this.symbology = newSymbology
  }
}
