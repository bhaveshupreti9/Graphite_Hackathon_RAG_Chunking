// Full ChatResult objects for answers in the current tab. The persisted store only keeps ChatTurns
// (spec C3 rule 10); this cache keeps citations, retrieved chunks and token counts while you move
// between pages. After a reload, older answers show as plain text.

import type { CompareResult } from '@/types/requests'
import type { ChatResult, Method } from '@/types/api'

const chatResults = new Map<string, ChatResult>()
const compareResults = new Map<string, CompareResult>()

export function chatKey(docId: string, method: Method, turnIndex: number): string {
  return `${docId}:${method}:${turnIndex}`
}

export const rememberChat = (key: string, result: ChatResult): void => {
  chatResults.set(key, result)
}

export const recallChat = (key: string): ChatResult | undefined => chatResults.get(key)

export const rememberCompare = (docId: string, question: string, result: CompareResult): void => {
  compareResults.set(`${docId}:${question}`, result)
}

export const recallCompare = (docId: string, question: string): CompareResult | undefined =>
  compareResults.get(`${docId}:${question}`)
