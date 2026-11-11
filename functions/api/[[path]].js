// Proxy /api/* da Cloudflare Pages verso la Edge Function di Supabase
// (supabase/functions/ruisearch-api). Il sito resta same-origin: niente CORS
// e il token di sessione viaggia nell'header Authorization.

const DEFAULT_ORIGIN = 'https://moyfkdwsghidkcifesrg.supabase.co/functions/v1/ruisearch-api';

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const origin = String(context.env.API_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
  const dest = origin + incoming.pathname + incoming.search;
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  const method = context.request.method;
  try {
    return await fetch(dest, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,
      redirect: 'manual',
    });
  } catch (err) {
    return Response.json(
      { errore: 'Il servizio non è raggiungibile in questo momento. Riprova tra poco.' },
      { status: 502 },
    );
  }
}
