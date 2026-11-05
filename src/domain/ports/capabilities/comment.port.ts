import type { AdapterResult } from '../../adapter-types.js'

export interface CommentInput {
  text: string
  target?: string
}

export interface CommentItem {
  author: string
  text: string
  id?: string
}

export interface CommentCapability {
  readonly capability: 'comment'
  comment(input: CommentInput): Promise<AdapterResult>
  replyComment(input: CommentInput): Promise<AdapterResult>
  browseComments(limit?: number): Promise<{ items: CommentItem[] }>
}
