import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/netlify-handler.mjs';

// Standard Netlify Functions v2 entrypoint. No custom path and no redirect.
// Netlify supplies the Blobs connection through its runtime automatically.
export default createHandler(() => getStore({
  name: 'two-truths-and-a-lie-rooms',
  consistency: 'strong',
}));
