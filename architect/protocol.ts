import { type Infer, literal, number, object, optional, string, union, unknown } from 'superstruct'

export const ProtocolQueryMessage = object({
  type: literal('query'),
  method: string(),
  id: number(),
  params: unknown(),
})

export type ProtocolQueryMessage = Infer<typeof ProtocolQueryMessage>

export const ProtocolError = object({
  code: number(),
  message: string(),
})

export type ProtocolError = Infer<typeof ProtocolError>

export const ProtocolResponseMessage = object({
  type: literal('response'),
  id: number(),
  result: optional(unknown()),
  error: optional(ProtocolError),
})

export type ProtocolResponseMessage = Infer<typeof ProtocolResponseMessage>

export const ProtocolMessage = union([ProtocolQueryMessage, ProtocolResponseMessage])

export type ProtocolMessage = Infer<typeof ProtocolMessage>
