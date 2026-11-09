import * as reliefweb from './reliefweb.mjs';
import * as unjobs from './unjobs-ethiopia.mjs';
import * as unEthiopia from './un-ethiopia.mjs';
import * as workethiopia from './workethiopia.mjs';
import * as ethiojobs from './ethiojobs.mjs';
import * as geezjobs from './geezjobs.mjs';
import * as ethiojobsNetEt from './ethiojobs-net-et.mjs';
import * as etcareers from './etcareers.mjs';
import * as ethiopianReporter from './ethiopian-reporter.mjs';
import * as alljobspo from './alljobspo.mjs';
import * as careersun from './careersun.mjs';
import * as genericRss from './generic-rss.mjs';

const registry = {
  [reliefweb.slug]: reliefweb,
  [unjobs.slug]: unjobs,
  [unEthiopia.slug]: unEthiopia,
  [workethiopia.slug]: workethiopia,
  [ethiojobs.slug]: ethiojobs,
  [geezjobs.slug]: geezjobs,
  [ethiojobsNetEt.slug]: ethiojobsNetEt,
  [etcareers.slug]: etcareers,
  [ethiopianReporter.slug]: ethiopianReporter,
  [alljobspo.slug]: alljobspo,
  [careersun.slug]: careersun,
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
