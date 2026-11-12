// code.justapps.it
//  - www.code.justapps.it → code.justapps.it
//  - /latest.tgz → latest GitHub release package (used by `npm install -g https://code.justapps.it/latest.tgz`)
//  - everything else: static site in ./public
const RELEASE = 'https://github.com/matthias-peterlini/just-code/releases/latest/download/just-code.tgz';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/latest.tgz' || url.pathname === '/just-code.tgz') {
      return Response.redirect(RELEASE, 302);
    }
    const res = await env.ASSETS.fetch(request);
    if (url.pathname.endsWith('.sh') || url.pathname.endsWith('.ps1')) {
      const h = new Headers(res.headers);
      h.set('content-type', 'text/plain; charset=utf-8');
      h.set('cache-control', 'no-cache');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
