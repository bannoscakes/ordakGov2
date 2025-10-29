/**
 * Distance Calculation Service
 * Uses Haversine formula for calculating distances between coordinates
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Calculate distance between two points using Haversine formula
 * @param point1 First coordinate
 * @param point2 Second coordinate
 * @returns Distance in kilometers
 */
export function calculateDistance(
  point1: Coordinates,
  point2: Coordinates
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(point2.latitude - point1.latitude);
  const dLon = toRadians(point2.longitude - point1.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.latitude)) *
      Math.cos(toRadians(point2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 10) / 10; // Round to 1 decimal place
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate normalized distance score (closer = higher score)
 * @param distanceKm Distance in kilometers
 * @param maxDistance Maximum distance to consider (default 50km)
 * @returns Score between 0.0 and 1.0
 */
export function calculateDistanceScore(
  distanceKm: number,
  maxDistance: number = 50
): number {
  if (distanceKm <= 0) return 1.0;
  if (distanceKm >= maxDistance) return 0.0;

  // Linear decay: score decreases linearly from 1.0 to 0.0
  const score = 1.0 - distanceKm / maxDistance;
  return Math.max(0, Math.min(1, score));
}

/**
 * Find the closest point from a list of coordinates
 * @param target Target coordinate
 * @param points List of coordinates to check
 * @returns Index and distance of closest point
 */
export function findClosestPoint(
  target: Coordinates,
  points: Coordinates[]
): { index: number; distance: number } | null {
  if (points.length === 0) return null;

  let closestIndex = 0;
  let minDistance = calculateDistance(target, points[0]);

  for (let i = 1; i < points.length; i++) {
    const distance = calculateDistance(target, points[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return { index: closestIndex, distance: minDistance };
}

/**
 * Calculate average distance from a point to multiple other points
 * Used for route efficiency calculations
 */
export function calculateAverageDistance(
  point: Coordinates,
  otherPoints: Coordinates[]
): number {
  if (otherPoints.length === 0) return 0;

  const totalDistance = otherPoints.reduce(
    (sum, otherPoint) => sum + calculateDistance(point, otherPoint),
    0
  );

  return totalDistance / otherPoints.length;
}
