export type QqPeerKind = 'direct' | 'group' | 'service'

const SERVICE_ACCOUNT =
  /(公众号|服务号|订阅号|官方账号|客服|QQ空间|腾讯新闻|看点|QQ会员)/

/**
 * Classifies a QQ notification into "a person", "a group" or "a service
 * account". Only `direct` should get an automatic reply: replying into a group
 * on every message would spam it, and service accounts never need an answer.
 */
export function classifyQqPeer(title: string, text: string): QqPeerKind {
  const peer = title.trim()
  // QQ appends the unread count to group names: 家庭群(5)
  if (/[（(]\d+[)）]\s*$/.test(peer)) {
    return 'group'
  }
  if (SERVICE_ACCOUNT.test(peer)) {
    return 'service'
  }
  // Group messages carry a sender prefix ("张三: 在吗"); a 1:1 message does not.
  const prefixed = /^([^\s:：]{1,12})[:：]\s*\S/.exec(text.trim())
  if (prefixed && prefixed[1] !== peer && !/^[\d.]+$/.test(prefixed[1])) {
    return 'group'
  }
  return 'direct'
}

/** Removes the group sender prefix before the text is used as message content. */
export function stripPeerPrefix(text: string): string {
  const trimmed = text.trim()
  const prefixed = /^[^\s:：]{1,12}[:：]\s*(\S.*)$/.exec(trimmed)
  return prefixed ? prefixed[1] : trimmed
}
