// Geolocation utility functions

import { UserFacingError } from "../errors";

export interface LocationData {
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  );
}

/**
 * Browser messages here are raw plumbing ("Position acquisition timed out,
 * NetworkError when attempting to fetch resource") that tell a shopper
 * nothing. Typing a pincode is all checkout actually needs, so every case
 * points there.
 */
function positionErrorMessage(error: unknown): string {
  const code = (error as { code?: number } | null)?.code;
  if (code === 1) return "Location is turned off. Please enter your pincode.";
  return "Couldn't find your location. Please enter your pincode.";
}

function permissionDenied(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 1;
}

/**
 * Get the shopper's current location, falling back to a coarse fix.
 *
 * The high-accuracy pass asks for GPS and refuses cached fixes, which on a
 * desktop browser with no GPS means waiting on a network lookup that can
 * simply fail. The second pass accepts a network-level fix up to ten
 * minutes old — plenty for measuring distance to the store in kilometres.
 */
export async function getCurrentLocation(): Promise<LocationData> {
  if (!navigator.geolocation) {
    throw new UserFacingError(
      "Couldn't find your location. Please enter your pincode."
    );
  }

  let position: GeolocationPosition;
  try {
    position = await getPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  } catch (first) {
    if (permissionDenied(first)) {
      throw new UserFacingError(positionErrorMessage(first));
    }
    try {
      position = await getPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 600000,
      });
    } catch (second) {
      throw new UserFacingError(positionErrorMessage(second));
    }
  }

  const { latitude, longitude } = position.coords;
  try {
    const addressData = await reverseGeocode(latitude, longitude);
    return { ...addressData, latitude, longitude };
  } catch {
    // Coordinates alone are enough to price delivery, so a blocked or slow
    // geocoder costs the shopper a filled-in address, not the quote.
    return { latitude, longitude, country: "India" };
  }
}

/**
 * Reverse geocode coordinates to address using Nominatim (OpenStreetMap)
 * This is a free service, but for production, consider using Google Maps API or similar
 */
async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<LocationData> {
  try {
    // Using Nominatim (OpenStreetMap) - free but has rate limits
    // Add zoom parameter for better address details
    // No User-Agent header: browsers forbid setting it, and sending it here
    // only risks tripping a CORS preflight that Nominatim will not answer.
    // The abort keeps a slow or blocked geocoder from stalling checkout.
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&accept-language=en&zoom=18`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!response.ok) {
      throw new Error("Reverse geocoding failed");
    }

    const data = await response.json();
    const address = data.address || {};
    const displayName = data.display_name || "";

    // Map OpenStreetMap address fields to our format
    // Focus on India-specific fields
    const locationData: LocationData = {
      country: address.country || "India",
    };

    // Extract city with priority order (city > town > village > suburb > county)
    locationData.city =
      address.city ||
      address.town ||
      address.village ||
      address.suburb ||
      address.county ||
      address.municipality ||
      "";

    // Extract state (could be state, region, or state_district)
    // For India, state is usually in the state field
    locationData.state =
      address.state ||
      address.region ||
      address.state_district ||
      "";

    // Extract pincode (postcode in OSM)
    locationData.pincode = address.postcode || "";

    // Build comprehensive address line
    const addressParts: string[] = [];
    
    // Add house number if available
    if (address.house_number) {
      addressParts.push(address.house_number);
    }
    
    // Add building name if available
    if (address.building) {
      addressParts.push(address.building);
    }
    
    // Add road/street name
    if (address.road) {
      addressParts.push(address.road);
    }
    
    // Add neighbourhood/locality
    if (address.neighbourhood) {
      addressParts.push(address.neighbourhood);
    }
    
    // Add area/suburb if not already included
    if (address.suburb && address.suburb !== locationData.city) {
      addressParts.push(address.suburb);
    }
    
    // If we have address parts, join them; otherwise use display_name
    if (addressParts.length > 0) {
      locationData.addressLine = addressParts.join(", ");
    } else if (displayName) {
      // Fallback to display_name and extract first part
      const parts = displayName.split(",");
      locationData.addressLine = parts[0] || "";
    }

    // If city is still empty, try to extract from display_name
    if (!locationData.city && displayName) {
      const parts = displayName.split(",");
      // Usually city is in the middle parts of the address
      for (let i = 1; i < parts.length - 2; i++) {
        const part = parts[i].trim();
        // Check if this part matches any Indian city (basic check)
        if (part && part.length > 2) {
          locationData.city = part;
          break;
        }
      }
    }

    // If state is still empty, try to extract from display_name
    if (!locationData.state && displayName) {
      const parts = displayName.split(",");
      // State is usually near the end
      for (let i = parts.length - 2; i >= 0; i--) {
        const part = parts[i].trim();
        // Check if this part could be a state (longer than 3 chars, not a number)
        if (part && part.length > 3 && !/^\d+$/.test(part)) {
          locationData.state = part;
          break;
        }
      }
    }

    // If pincode is still empty, try to extract from display_name
    if (!locationData.pincode && displayName) {
      const pincodeMatch = displayName.match(/\b[1-9][0-9]{5}\b/);
      if (pincodeMatch) {
        locationData.pincode = pincodeMatch[0];
      }
    }

    return locationData;
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    throw error;
  }
}

/**
 * Alternative: Use Google Maps Geocoding API (requires API key)
 * Uncomment and use this if you have a Google Maps API key
 */
/*
export async function reverseGeocodeGoogle(
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<LocationData> {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&region=in`
    );

    if (!response.ok) {
      throw new Error("Reverse geocoding failed");
    }

    const data = await response.json();
    
    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      throw new Error("No results found");
    }

    const result = data.results[0];
    const addressComponents = result.address_components;
    
    const locationData: LocationData = {
      addressLine: result.formatted_address.split(",")[0] || "",
      country: "India",
    };

    // Parse address components
    addressComponents.forEach((component: any) => {
      const types = component.types;
      
      if (types.includes("postal_code")) {
        locationData.pincode = component.long_name;
      } else if (types.includes("locality") || types.includes("sublocality")) {
        locationData.city = component.long_name;
      } else if (types.includes("administrative_area_level_1")) {
        locationData.state = component.long_name;
      }
    });

    return locationData;
  } catch (error) {
    console.error("Google reverse geocoding error:", error);
    throw error;
  }
}
*/

