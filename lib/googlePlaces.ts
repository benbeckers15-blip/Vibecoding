import Constants from "expo-constants";

const GOOGLE_API_KEY =
  Constants.expoConfig?.extra?.googleApiKey ||
  process.env.EXPO_PUBLIC_GOOGLE_API_KEY; // ✅ fallback support

export async function fetchPlaceDetails(placeId: string) {
  if (!GOOGLE_API_KEY) {
    console.error("❌ Missing Google API key in Expo config or env.");
    throw new Error("Missing Google API key");
  }

  if (!placeId) {
    console.error("❌ Missing Google Place ID");
    throw new Error("Missing Google Place ID");
  }

  // ✅ Added `rating` to the fields list
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,opening_hours,photos,geometry,rating&key=${GOOGLE_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      console.error("❌ Google Places API Error:", data.status, data.error_message);
      throw new Error(data.error_message || "Failed to fetch place details");
    }

    const result = data.result || {};

    // ✅ Return the rating field too
    return {
      formatted_phone_number: result.formatted_phone_number || null,
      website: result.website || null,
      opening_hours: result.opening_hours || null,
      photos: result.photos || [],
      geometry: result.geometry || null, // lat/lng support
      rating: result.rating || null, // ⭐ Added rating
    };
  } catch (error) {
    console.error("🔥 fetchPlaceDetails failed:", error);
    throw error;
  }
}


