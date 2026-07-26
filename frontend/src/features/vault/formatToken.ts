export function formatUsdc6(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0')
  return `${whole.toLocaleString('en-US')}.${fracStr}`
}

export function formatInj(raw: bigint): string {
  const whole = raw / 10n ** 18n
  const frac = (raw % 10n ** 18n) / 10n ** 12n
  return `${whole.toLocaleString('en-US')}.${frac.toString().padStart(6, '0')}`
}

export function shortenAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}…${address.slice(-tail)}`
}
