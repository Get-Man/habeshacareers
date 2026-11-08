import * as reliefweb from './reliefweb.mjs';
import * as unjobs from './unjobs-ethiopia.mjs';
import * as unEthiopia from './un-ethiopia.mjs';

const registry = {
  [reliefweb.slug]: reliefweb,
  [unjobs.slug]: unjobs,
  [unEthiopia.slug]: unEthiopia,
};

export function getConnector(slug) {
  return registry[slug] || null;
}

export function listSupportedConnectorSlugs() {
  return Object.keys(registry);
}
