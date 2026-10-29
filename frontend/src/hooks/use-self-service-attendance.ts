"use client";

import type { AttendancePlan } from "@/components/self-service/self-service-model";

/** Invoked only by an explicit check-in action. Never requests location during reads. */
export async function selfCheckInBody(plan: AttendancePlan): Promise<string | undefined | null> {
  if (plan.mode === "off") throw new Error("Today is scheduled as a day off. Contact HR if an exception is needed.");
  if (plan.mode === "office") {
    if (!navigator.geolocation) throw new Error("GPS is unavailable in this browser. Open Business OS in your mobile browser.");
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
    return JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy, location_timestamp_ms: position.timestamp });
  }
  if (plan.mode === "field") {
    const location = window.prompt("Which assigned client site or field location are you working at?");
    if (location === null) return null;
    const field_location = location.trim();
    if (field_location.length < 3 || field_location.length > 180) throw new Error("Enter your assigned field location using 3–180 characters.");
    return JSON.stringify({ field_location });
  }
  return undefined;
}
