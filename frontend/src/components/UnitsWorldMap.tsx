import { DottedMap, type Marker } from '@/components/ui/dotted-map'
import { cn } from '@/lib/utils'

/** Global risk / market hubs shown on policy surfaces */
const DEFAULT_MARKERS: Marker[] = [
  { lat: 40.71, lng: -74.0, size: 0.45, pulse: true }, // New York
  { lat: 51.5, lng: -0.12, size: 0.38 }, // London
  { lat: 35.68, lng: 139.69, size: 0.4, pulse: true }, // Tokyo
  { lat: 1.35, lng: 103.82, size: 0.35 }, // Singapore
  { lat: 25.2, lng: 55.27, size: 0.32 }, // Dubai
  { lat: -23.55, lng: -46.63, size: 0.3 }, // São Paulo
  { lat: 37.77, lng: -122.42, size: 0.36 }, // SF
]

export function UnitsWorldMap({
  className,
  markers = DEFAULT_MARKERS,
  caption,
  compact = false,
}: {
  className?: string
  markers?: Marker[]
  caption?: string
  compact?: boolean
}) {
  return (
    <figure
      className={cn(
        'relative overflow-hidden rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_70%,transparent)]',
        className
      )}
    >
      <div
        className={cn(
          'relative w-full text-[color-mix(in_srgb,var(--units-black)_28%,transparent)]',
          compact ? 'aspect-[2.4/1] min-h-[96px]' : 'aspect-[2.2/1] min-h-[140px]'
        )}
      >
        <DottedMap
          className="absolute inset-0 size-full text-[color-mix(in_srgb,var(--units-black)_32%,transparent)]"
          width={compact ? 120 : 160}
          height={compact ? 55 : 75}
          mapSamples={compact ? 2800 : 4200}
          markers={markers}
          markerColor="var(--units-orange)"
          dotRadius={compact ? 0.18 : 0.22}
          pulse
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--units-soft)] to-transparent"
        />
      </div>
      {caption ? (
        <figcaption className="absolute bottom-2 left-3 right-3 text-[11px] font-medium tracking-wide text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
