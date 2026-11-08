import * as reliefweb from './reliefweb.mjs';

const registry = {
  [reliefweb.slug]: reliefweb,
};

export function getConnector(slug) {
  return registry[slug] || null;
}

export function listSupportedConnectorSlugs() {
  return Object.keys(registry);
}
