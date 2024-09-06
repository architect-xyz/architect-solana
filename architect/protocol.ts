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

export const ProtocolSubscribeMessage = object({
  type: literal('subscribe'),
  id: number(),
  topic: string(),
})

export type ProtocolSubscribeMessage = Infer<typeof ProtocolSubscribeMessage>

export const ProtocolUnsubscribeMessage = object({
  type: literal('unsubscribe'),
  id: number(),
  topic: string(),
  sub_id: optional(number()),
})

export type ProtocolUnsubscribeMessage = Infer<typeof ProtocolUnsubscribeMessage>

export const ProtocolUpdateMessage = object({
  type: literal('update'),
  id: number(),
  data: unknown(),
})

export type ProtocolUpdateMessage = Infer<typeof ProtocolUpdateMessage>

export const ProtocolMessage = union([
  ProtocolQueryMessage,
  ProtocolResponseMessage,
  ProtocolSubscribeMessage,
  ProtocolUnsubscribeMessage,
  ProtocolUpdateMessage,
])

export type ProtocolMessage = Infer<typeof ProtocolMessage>
