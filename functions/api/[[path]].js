// Proxy /api/* dal frontend Pages verso l'API Node sul VPS.

const DEFAULT_ORIGIN = 'http://31.220.82.50:8787';

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const origin = String(context.env.API_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
  const rest = incoming.pathname.replace(/^\/api/, '') || '/';
  const dest = origin + rest + incoming.search;
  const headers = new Headers(context.request.headers);
  headers.delete('host');
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
      { errore: `API non raggiungibile (${err.message || 'fetch fallita'})` },
      { status: 502 },
    );
  }
}
