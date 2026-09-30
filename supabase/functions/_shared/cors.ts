// CORS for browser calls from the web app. Restrict ALLOWED_ORIGINS in
// production (comma-separated), e.g.
//   "https://diwakar-suite.pages.dev,https://*.diwakar-suite.pages.dev"
// An entry "https://*.example.com" allows that site's subdomains (Cloudflare
// Pages gives every preview build its own), never the bare domain's siblings.
const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

function isAllowed(origin: string): boolean {
  return allowed.some((entry) => {
    if (entry === origin) return true;
    const wild = entry.match(/^(https?:\/\/)\*\.(.+)$/);
    return !!wild && origin.startsWith(wild[1]) && origin.endsWith(`.${wild[2]}`)
      && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(origin.slice(wild[1].length, -wild[2].length - 1));
  });
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = allowed.includes('*') ? '*' : isAllowed(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}
