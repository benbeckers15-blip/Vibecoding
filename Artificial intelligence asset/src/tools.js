/**
 * tools.js — Anthropic tool definitions + dispatcher for the concierge.
 *
 * Three tools, all spatial. The concierge is required by its system prompt
 * to call these — never to guess — for any question involving distance,
 * drive time, direction, or proximity between places.
 *
 *   get_drive_time         one-to-one drive time + distance
 *   get_distance_matrix    many-to-many drive matrix; ranks proximity
 *   get_compass_bearing    cardinal direction (N/NE/E/...) from A to B
 *
 * Each tool accepts a "location reference" string for each endpoint:
 *   - a winery slug from the dataset (e.g. "house-of-arras", "pooley-wines")
 *   - a free-form place name ("Hobart", "Launceston CBD", "Freycinet")
 *   - the literal form "lat,lng" (e.g. "-42.88,147.33")
 *
 * Slug lookups are local (cached dataset). Everything else goes through
 * Google's Geocoding/Distance Matrix APIs.
 */

const maps = require('./maps');

// ---------------------------------------------------------------------------
// Tool schemas (sent to Claude)
// ---------------------------------------------------------------------------

const LOCATION_REF_DESC =
  'A winery slug from the dataset (e.g. "house-of-arras"), a place name ' +
  '("Hobart", "Launceston", "Freycinet"), or a literal "lat,lng" pair. ' +
  'Slugs are resolved locally; everything else is geocoded by Google with ' +
  'a Tasmania, Australia bias.';

const TOOLS = [
  {
    name: 'get_drive_time',
    description:
      'Get the real driving time and distance between two places via Google ' +
      'Maps. Call this whenever a user asks "how far", "how long to drive", ' +
      '"how do I get from X to Y", or any question that depends on travel ' +
      'time. Never estimate drive times yourself.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: LOCATION_REF_DESC },
        destination: { type: 'string', description: LOCATION_REF_DESC },
        mode: {
          type: 'string',
          enum: ['driving', 'walking', 'bicycling'],
          description: 'Travel mode. Defaults to driving.',
        },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'get_distance_matrix',
    description:
      'Get a many-to-many matrix of driving times and distances between sets ' +
      'of places. Use this for "which of these wineries is closest to X", ' +
      'for ordering an itinerary efficiently, or for grouping wineries by ' +
      'proximity. One call covers up to ~25 destinations.',
    input_schema: {
      type: 'object',
      properties: {
        origins: {
          type: 'array',
          items: { type: 'string', description: LOCATION_REF_DESC },
          description: 'One or more starting points.',
          minItems: 1,
        },
        destinations: {
          type: 'array',
          items: { type: 'string', description: LOCATION_REF_DESC },
          description: 'One or more endpoints.',
          minItems: 1,
        },
        mode: {
          type: 'string',
          enum: ['driving', 'walking', 'bicycling'],
          description: 'Travel mode. Defaults to driving.',
        },
      },
      required: ['origins', 'destinations'],
    },
  },
  {
    name: 'get_compass_bearing',
    description:
      'Get the compass direction (north, northeast, east, etc.) and ' +
      'straight-line distance from origin to destination. Call this for ' +
      'questions like "is X north of Y", "which way is X from Y", or ' +
      'whenever orienting wineries relative to each other. Never guess ' +
      'directions yourself — Tasmania\'s geography is full of traps ' +
      '(e.g. Tamar Valley is northwest of Pipers River, not east).',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: LOCATION_REF_DESC },
        destination: { type: 'string', description: LOCATION_REF_DESC },
      },
      required: ['origin', 'destination'],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatcher: take a tool_use block from Claude, run it, return JSON content.
// ---------------------------------------------------------------------------

async function runTool(name, input) {
  switch (name) {
    case 'get_drive_time':
      return await maps.driveTime(input.origin, input.destination, input.mode || 'driving');

    case 'get_distance_matrix':
      return await maps.driveMatrix(input.origins, input.destinations, input.mode || 'driving');

    case 'get_compass_bearing':
      return await maps.compassBearing(input.origin, input.destination);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Run a tool_use block from a Claude response and return the matching
 * tool_result block for the next user-turn message. Errors are returned as
 * error tool_results rather than thrown, so the model can recover (e.g. by
 * rephrasing a location it got wrong).
 */
async function handleToolUse(block) {
  try {
    const result = await runTool(block.name, block.input || {});
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content: `Tool ${block.name} failed: ${err.message}`,
    };
  }
}

module.exports = { TOOLS, runTool, handleToolUse };
