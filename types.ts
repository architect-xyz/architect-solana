// modified from solana-web3.js

import {
  type as pick,
  number,
  string,
  array,
  boolean,
  literal,
  union,
  optional,
  nullable,
  coerce,
  instance,
  create,
  unknown,
  any,
  Struct,
} from 'superstruct'
import { PublicKey } from '@solana/web3.js'

function createRpcSubscriptionResult<T, U>(result: Struct<T, U>) {
  return union([
    pick({
      jsonrpc: literal('2.0'),
      method: string(),
      params: pick({
        subscription: number(),
        result,
      }),
    }),
    pick({
      jsonrpc: literal('2.0'),
      id: number(),
      result: number(),
    }),
    pick({
      jsonrpc: literal('2.0'),
      id: number(),
      error: pick({
        code: unknown(),
        message: string(),
        data: optional(any()),
      }),
    }),
  ])
}

const UnknownRpcResult = createRpcSubscriptionResult(unknown())

function jsonRpcSubscriptionResult<T, U>(schema: Struct<T, U>) {
  return coerce(createRpcSubscriptionResult(schema), UnknownRpcResult, (value) => {
    if ('error' in value) {
      return value
    } else if ('params' in value) {
      return {
        ...value,
        params: {
          ...value.params,
          result: create(value.params.result, schema),
        },
      }
    } else {
      return value
    }
  })
}

const PublicKeyFromString = coerce(instance(PublicKey), string(), (value) => new PublicKey(value))

const ParsedInstructionResult = pick({
  parsed: unknown(),
  program: string(),
  programId: PublicKeyFromString,
})

const RawInstructionResult = pick({
  accounts: array(PublicKeyFromString),
  data: string(),
  programId: PublicKeyFromString,
})

const InstructionResult = union([RawInstructionResult, ParsedInstructionResult])

const UnknownInstructionResult = union([
  pick({
    parsed: unknown(),
    program: string(),
    programId: string(),
  }),
  pick({
    accounts: array(string()),
    data: string(),
    programId: string(),
  }),
])

const ParsedOrRawInstruction = coerce(InstructionResult, UnknownInstructionResult, (value) => {
  if ('accounts' in value) {
    return create(value, RawInstructionResult)
  } else {
    return create(value, ParsedInstructionResult)
  }
})

const AnnotatedAccountKey = pick({
  pubkey: PublicKeyFromString,
  signer: boolean(),
  writable: boolean(),
  source: optional(union([literal('transaction'), literal('lookupTable')])),
})

const AddressTableLookupStruct = pick({
  accountKey: PublicKeyFromString,
  writableIndexes: array(number()),
  readonlyIndexes: array(number()),
})

const ParsedConfirmedTransactionResult = pick({
  signatures: array(string()),
  message: pick({
    accountKeys: array(AnnotatedAccountKey),
    instructions: array(ParsedOrRawInstruction),
    recentBlockhash: string(),
    addressTableLookups: optional(nullable(array(AddressTableLookupStruct))),
  }),
})

const TransactionErrorResult = nullable(union([pick({}), string()]))

const TokenAmountResult = pick({
  amount: string(),
  uiAmount: nullable(number()),
  decimals: number(),
  uiAmountString: optional(string()),
})

const TokenBalanceResult = pick({
  accountIndex: number(),
  mint: string(),
  owner: optional(string()),
  uiTokenAmount: TokenAmountResult,
})

const LoadedAddressesResult = pick({
  writable: array(PublicKeyFromString),
  readonly: array(PublicKeyFromString),
})

const ParsedConfirmedTransactionMetaResult = pick({
  err: TransactionErrorResult,
  fee: number(),
  innerInstructions: optional(
    nullable(
      array(
        pick({
          index: number(),
          instructions: array(ParsedOrRawInstruction),
        })
      )
    )
  ),
  preBalances: array(number()),
  postBalances: array(number()),
  logMessages: optional(nullable(array(string()))),
  preTokenBalances: optional(nullable(array(TokenBalanceResult))),
  postTokenBalances: optional(nullable(array(TokenBalanceResult))),
  loadedAddresses: optional(LoadedAddressesResult),
  computeUnitsConsumed: optional(number()),
})

const TransactionVersionStruct = union([literal(0), literal('legacy')])

export const TransactionSubscriptionNotification = jsonRpcSubscriptionResult(
  nullable(
    pick({
      transaction: pick({
        transaction: ParsedConfirmedTransactionResult,
        meta: nullable(ParsedConfirmedTransactionMetaResult),
        version: optional(TransactionVersionStruct),
      }),
      signature: string(),
      slot: number(),
    })
  )
)
