const LINK_RE = /https?:\/\/|www\./gi;

/**
 * Returns a reason string if the submission looks like spam, else null.
 *  1. Honeypot: an input humans never see; any non-empty value means a bot filled it.
 *  2. Heuristic: link-stuffed messages (more than 2 links across all fields).
 */
export function detectSpam({ hp, data }) {
  if (hp !== undefined && hp !== null && hp !== '' && !(typeof hp === 'string' && hp.trim() === '')) return 'honeypot';
  const links = (Object.values(data).filter((v) => typeof v === 'string').join(' ').match(LINK_RE) || []).length;
  if (links > 2) return 'too_many_links';
  return null;
}
