// Proxy /api/* da Pages verso il server (hostname, mai un IP grezzo: errore 1003).

const DEFAULT_ORIGIN = 'http://vmi3562343.contaboserver.net';

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const origin = String(context.env.API_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
  const dest = origin + incoming.pathname + incoming.search;
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
