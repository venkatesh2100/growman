import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

// ── Types ─────────────────────────────────────────────────────────
interface CfProperties {
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  asn?: number;
}

// ── Helpers ───────────────────────────────────────────────────────
function getDeviceType(ua: string): string {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(ua)) return 'mobile';
  return 'desktop';
}

const BOT_UA_RE = /bot|crawler|spider|crawling|facebookexternalhit|linkedinbot|twitterbot|whatsapp|slack|discord|preview|wget|curl|python|java|go-http|axios|node-fetch|okhttp|libwww|zgrab|nmap|nikto|nuclei|sqlmap|masscan|censys|shodan|GPTBot|ChatGPT-User|CCBot|anthropic-ai|ClaudeBot|cohere-ai|Google-Extended|Amazonbot|PerplexityBot|YouBot|Bytespider|PetalBot|SemrushBot|AhrefsBot|MJ12bot/i;

const BOT_PATH_RE = /^\/(robots\.txt|app-ads\.txt|sitemap.*\.xml|\.well-known|wp-admin|wp-login|wp-includes|xmlrpc\.php|admin\/controller|sites\/default|phpmyadmin|\.env|\.git)/i;

const DATACENTER_ASNS = new Set([
  16509, 14618,  // AWS
  15169, 396982, // GCP
  8075,          // Azure
  14061,         // DigitalOcean
  16276,         // OVH
  24940,         // Hetzner
  63949,         // Linode
]);

// ── Middleware ────────────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  try {
    const pathname = new URL(request.url).pathname;

    // Layer 0: skip non-page requests
    const isRSC    = request.headers.has('rsc') || request.nextUrl.searchParams.has('_rsc');
    const isStatic = pathname.startsWith('/_next/');
    const isApi    = pathname.startsWith('/api/');
    const isImage  = /\.(ico|png|jpg|jpeg|svg|webp|avif)$/.test(pathname);
    if (isRSC || isStatic || isApi || isImage) return response;

    // Layer 1: bot path filter
    if (BOT_PATH_RE.test(pathname)) return response;

    // Layer 2: header validation
    const accept = request.headers.get('accept') ?? '';
    if (!accept.includes('text/html')) return response;

    const secFetchMode = request.headers.get('sec-fetch-mode');
    if (secFetchMode !== 'navigate') return response;

    // Layer 3: UA validation
    const ua = request.headers.get('user-agent') ?? '';
    if (!ua || ua.length < 20) return response;
    if (BOT_UA_RE.test(ua)) return response;
    if (/Headless|Phantom|Puppeteer|Playwright/i.test(ua)) return response;

    const { env, cf } = getCloudflareContext();
    const cfProps = cf as CfProperties;

    // Layer 4: datacenter ASN filter
    if (cfProps.asn && DATACENTER_ASNS.has(cfProps.asn)) return response;

    // Layer 5: cookie suspicion score
    const cookieHeader = request.headers.get('cookie') ?? '';
    const hasVid              = cookieHeader.includes('vid=');
    const hasSid              = cookieHeader.includes('sid=');
    const isSuspiciousFirstHit = !hasVid && !hasSid;

    // Layer 6: KV rate limit
    const ip    = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const kvKey = `rl:${ip}`;

    if (env.RATE_LIMIT) {
      const raw   = await env.RATE_LIMIT.get(kvKey);
      const count = raw ? parseInt(raw, 10) : 0;

      if (count >= 10) return response;

      await env.RATE_LIMIT.put(kvKey, String(count + 1), {
        expirationTtl: 60,
      });

      if (isSuspiciousFirstHit && count > 3) return response;
    }

    // ── WAE write ─────────────────────────────────────────────────
    const country    = cfProps.country    ?? 'XX';
    const region     = cfProps.region     ?? 'Unknown';
    const regionCode = cfProps.regionCode ?? 'XX';
    const city       = cfProps.city       ?? 'Unknown';
    const device     = getDeviceType(ua);

    let visitorId    = request.cookies.get('vid')?.value ?? null;
    let isNewVisitor = 0;
    if (!visitorId) {
      visitorId    = crypto.randomUUID();
      isNewVisitor = 1;
      response.cookies.set('vid', visitorId, {
        maxAge:   60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: 'lax',
        path:     '/',
      });
    }

    let sessionId    = request.cookies.get('sid')?.value ?? null;
    let isNewSession = 0;
    if (!sessionId) {
      sessionId    = crypto.randomUUID();
      isNewSession = 1;
    }
    response.cookies.set('sid', sessionId, {
      maxAge:   60 * 30,
      httpOnly: true,
      sameSite: 'lax',
      path:     '/',
    });

    if (env.WAE) {
      env.WAE.writeDataPoint({
        blobs:   [country, region, regionCode, city, pathname, device, visitorId, sessionId],
        doubles: [1, isNewVisitor, isNewSession],
        indexes: [country],
      });
    }
  } catch (e) {
    console.error('[WAE] error:', e);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots\\.txt|app-ads\\.txt|sitemap.*\\.xml).*)'],
};