/** Pixel art presets ported from nchs-ai-site `PixelGrid.astro`. */

export type PixelTone = 'blue' | 'yellow' | 'orange' | 'green' | 'lilac'
export type PixelPattern = 'people' | 'design' | 'care' | 'spark'

export const PIXEL_COLUMNS = 14
export const PIXEL_ROWS = 9

function cellKey(row: number, column: number) {
  return `${row}:${column}`
}

const k = cellKey

export const PIXEL_PATTERNS: Record<
  PixelPattern,
  Record<string, PixelTone>
> = {
  people: Object.fromEntries([
    ...[4, 5, 6, 7, 8, 9].map((column) => [k(1, column), 'green']),
    ...[3, 10].map((column) => [k(2, column), 'green']),
    ...[2, 11].map((column) => [k(3, column), 'green']),
    ...[2, 11].map((column) => [k(4, column), 'green']),
    [k(4, 5), 'green'],
    [k(4, 8), 'green'],
    ...[2, 11].map((column) => [k(5, column), 'green']),
    ...[3, 10].map((column) => [k(6, column), 'green']),
    ...[4, 5, 6, 7, 8, 9].map((column) => [k(7, column), 'green']),
  ]),
  design: Object.fromEntries([
    [k(1, 6), 'orange'],
    [k(2, 5), 'orange'],
    [k(2, 6), 'orange'],
    [k(2, 7), 'orange'],
    [k(3, 4), 'orange'],
    [k(3, 6), 'orange'],
    [k(3, 8), 'orange'],
    [k(4, 5), 'orange'],
    [k(4, 7), 'orange'],
    [k(4, 9), 'orange'],
    [k(5, 6), 'orange'],
    [k(5, 8), 'orange'],
    [k(5, 10), 'orange'],
    [k(6, 7), 'orange'],
    [k(6, 9), 'orange'],
    [k(6, 10), 'orange'],
    [k(7, 8), 'orange'],
    [k(7, 9), 'orange'],
    [k(7, 10), 'orange'],
  ]),
  care: Object.fromEntries([
    ...[4, 5, 8, 9].map((column) => [k(2, column), 'yellow']),
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((column) => [k(3, column), 'yellow']),
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((column) => [k(4, column), 'yellow']),
    ...[4, 5, 6, 7, 8, 9].map((column) => [k(5, column), 'yellow']),
    ...[5, 6, 7, 8].map((column) => [k(6, column), 'yellow']),
    ...[6, 7].map((column) => [k(7, column), 'yellow']),
  ]),
  spark: Object.fromEntries([
    [k(1, 6), 'lilac'],
    [k(1, 7), 'lilac'],
    [k(2, 6), 'lilac'],
    [k(2, 7), 'lilac'],
    [k(3, 3), 'blue'],
    [k(3, 6), 'yellow'],
    [k(3, 7), 'yellow'],
    [k(3, 10), 'orange'],
    [k(4, 4), 'blue'],
    [k(4, 5), 'yellow'],
    [k(4, 6), 'yellow'],
    [k(4, 7), 'yellow'],
    [k(4, 8), 'yellow'],
    [k(4, 9), 'orange'],
    [k(5, 5), 'green'],
    [k(5, 6), 'green'],
    [k(5, 7), 'green'],
    [k(5, 8), 'green'],
    [k(6, 6), 'orange'],
    [k(6, 7), 'orange'],
    [k(7, 6), 'orange'],
    [k(7, 7), 'orange'],
  ]),
}

export function getPixelCells(pattern: PixelPattern): Array<PixelTone | ''> {
  const map = PIXEL_PATTERNS[pattern]
  return Array.from({ length: PIXEL_COLUMNS * PIXEL_ROWS }, (_, index) => {
    const row = Math.floor(index / PIXEL_COLUMNS)
    const column = index % PIXEL_COLUMNS
    return map[cellKey(row, column)] ?? ''
  })
}
