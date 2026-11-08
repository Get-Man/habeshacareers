import * as reliefweb from './reliefweb.mjs';
import * as unjobs from './unjobs-ethiopia.mjs';
import * as unEthiopia from './un-ethiopia.mjs';
import * as workethiopia from './workethiopia.mjs';
import * as ethiojobs from './ethiojobs.mjs';
import * as genericRss from './generic-rss.mjs';

const registry = {
  [reliefweb.slug]: reliefweb,
  [unjobs.slug]: unjobs,
  [unEthiopia.slug]: unEthiopia,
  [workethiopia.slug]: workethiopia,
  [ethiojobs.slug]: ethiojobs,
};

export function getConnector(slug) {
  return registry[slug] || null;
}

export function getConnectorForSource(source) {
  if (!source) return null;
  const direct = getConnector(source.slug);
  if (direct) return direct;
  const type = String(source.source_type || '').toLowerCase();
  const feedUrl = source?.fetch_config?.feedUrl || source?.listing_url;
  if ((type === 'rss' || type === 'atom' || type === 'feed' || type === 'xml') && feedUrl) return genericRss;
  return null;
}

export function listSupportedConnectorSlugs() {
  return Object.keys(registry);
}
