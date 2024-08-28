import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Helius } from 'helius-sdk'
import * as Phoenix from '@ellipsis-labs/phoenix-sdk'
import 'dotenv/config'
import { TransactionSubscriptionNotification } from './types.ts'
import { create } from 'superstruct'

const WSS_ENDPOINT = process.env['WSS_ENDPOINT']!
const HTTP_ENDPOINT = process.env['HTTP_ENDPOINT']!
const HELIUS_API_KEY = process.env['HELIUS_API_KEY']!

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
          // TODO: try watching the main Phoenix.PROGRAM_ID account
          accountInclude: ['4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg'],
        },
        {
          commitment: 'processed',
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
      console.dir(decoded, { depth: null })
    }
  }
})

// const helius = new Helius(HELIUS_API_KEY)

// const solana = new Connection(HTTP_ENDPOINT, { wsEndpoint: WSS_ENDPOINT })
//
// const SIG =
//   '2t5txyit9kQuegFWyioPoAnCcib2NFtjK6o52msfKW8seg95z6YzTjGY6dmvSKgj3SZqo9qsLxAkqWxZVh2YBHRq'
//
// const parsed = await solana.getParsedTransaction(SIG)
// const parsed = await Phoenix.getPhoenixEventsFromTransactionSignature(solana, SIG)
// console.dir(parsed, { depth: null })
// const ACCOUNT_TO_WATCH = new PublicKey('4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg')
// const subscriptionId = solanaConnection.onAccountChange(
//   ACCOUNT_TO_WATCH,
//   (updatedAccountInfo, context) => {
//     console.log(`Slot: ${context.slot} -- ${updatedAccountInfo.lamports / LAMPORTS_PER_SOL} SOL`)
//   },
//   { commitment: 'confirmed' }
// )
// console.log('Starting web socket, subscription ID: ', subscriptionId)

await new Promise(() => {})
