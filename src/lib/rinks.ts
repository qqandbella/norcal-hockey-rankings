export interface RinkLocation {
  lat: number
  lon: number
}

/** Approximate rink locations -- eyeballed from each rink's general area,
 * not surveyed addresses -- used only for a straight-line distance /
 * estimated drive time between two games. Good enough to flag a likely
 * conflict, not turn-by-turn navigation. San Jose's several named sheets
 * (Black/Grey/Orange/Sharks/Tech CU) and Roseville's two sheets are all
 * effectively the same facility, so they share one point. */
export const RINK_LOCATIONS: Record<string, RinkLocation> = {
  Bridgepointe: { lat: 37.5485, lon: -122.301 },
  Dublin: { lat: 37.705, lon: -121.924 },
  Fremont: { lat: 37.5483, lon: -121.9886 },
  Fresno: { lat: 36.7378, lon: -119.7871 },
  'Lake Tahoe': { lat: 38.9399, lon: -119.9772 },
  'Oakland NHL': { lat: 37.8044, lon: -122.2712 },
  'Reno Ice': { lat: 39.5296, lon: -119.8138 },
  'Roseville #1': { lat: 38.7521, lon: -121.288 },
  'Roseville #2': { lat: 38.7521, lon: -121.288 },
  'San Jose Black': { lat: 37.3838, lon: -121.947 },
  'San Jose Grey': { lat: 37.3838, lon: -121.947 },
  'San Jose Orange': { lat: 37.3838, lon: -121.947 },
  'San Jose Sharks': { lat: 37.3838, lon: -121.947 },
  'San Jose Tech CU': { lat: 37.3838, lon: -121.947 },
  'Santa Rosa': { lat: 38.4293, lon: -122.7141 },
  Stockton: { lat: 37.9577, lon: -121.2908 },
  'Vacaville Davis': { lat: 38.3566, lon: -121.9877 },
  Vallco: { lat: 37.323, lon: -122.0192 },
  'Yerba Buena': { lat: 37.3346, lon: -121.8211 },
}

const EARTH_RADIUS_MILES = 3958.8

// Straight-line distance understates actual road distance -- this
// multiplier approximates typical Bay Area/NorCal road-network "detour
// factor", not a per-route measurement.
const ROAD_DISTANCE_FACTOR = 1.3

// Blended local-arterial/highway average speed. Not time-of-day or
// traffic aware -- a Friday 5pm Bay Area commute will run well over this.
const AVG_DRIVE_SPEED_MPH = 45

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineMiles(a: RinkLocation, b: RinkLocation): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface DriveEstimate {
  miles: number
  minutes: number
}

/**
 * Estimated drive distance/time between two rinks -- straight-line
 * distance scaled by a road-network detour factor and a blended average
 * speed. A same-ballpark approximation for flagging likely conflicts, not
 * turn-by-turn navigation. Returns null if either rink's location is
 * unknown (a rink name that doesn't match `RINK_LOCATIONS`).
 */
export function estimateDrive(rinkA: string, rinkB: string): DriveEstimate | null {
  if (rinkA === rinkB) return { miles: 0, minutes: 0 }
  const a = RINK_LOCATIONS[rinkA]
  const b = RINK_LOCATIONS[rinkB]
  if (!a || !b) return null
  const miles = Math.round(haversineMiles(a, b) * ROAD_DISTANCE_FACTOR * 10) / 10
  const minutes = Math.round((miles / AVG_DRIVE_SPEED_MPH) * 60)
  return { miles, minutes }
}
