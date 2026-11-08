import * as reliefweb from './reliefweb.mjs';
import * as unjobs from './unjobs-ethiopia.mjs';

const registry = {
  [reliefweb.slug]: reliefweb,
  [unjobs.slug]: unjobs,
};

export function getConnector(slug) {
  return registry[slug] || null;
}

export function listSupportedConnectorSlugs() {
  return Object.keys(registry);
}
