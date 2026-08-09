// ==========================================================
// mini-hono.js — Router minimal yang meniru subset API Hono
// (app.get/post/put/delete, middleware chain, Context c) supaya
// logika src/index.ts (asli untuk Cloudflare Worker) bisa dipakai
// APA ADANYA di browser tanpa server, lewat intercept fetch().
// Tidak butuh bundler / import bare-specifier — pure ESM relatif.
// ==========================================================

class HonoRequest {
  constructor(rawRequest, params, url) {
    this.raw = rawRequest;
    this._params = params || {};
    this._url = url;
    this.path = url.pathname;
    this.method = rawRequest.method;
  }
  param(key) {
    if (key === undefined) return this._params;
    return this._params[key];
  }
  query(key) {
    if (key === undefined) {
      const out = {};
      for (const [k, v] of this._url.searchParams.entries()) out[k] = v;
      return out;
    }
    const v = this._url.searchParams.get(key);
    return v === null ? undefined : v;
  }
  async json() {
    const text = await this.raw.text();
    if (!text) return {};
    return JSON.parse(text);
  }
  async parseBody() {
    const form = await this.raw.formData();
    const out = {};
    for (const [k, v] of form.entries()) out[k] = v;
    return out;
  }
}

export class Context {
  constructor(rawRequest, params, url, env) {
    this.req = new HonoRequest(rawRequest, params, url);
    this.env = env;
    this.res = undefined;
    this._vars = {};
    this.executionCtx = {
      waitUntil(promise) {
        Promise.resolve(promise).catch((err) => console.warn('waitUntil error', err));
      },
    };
  }
  get(key) {
    return this._vars[key];
  }
  set(key, value) {
    this._vars[key] = value;
  }
  json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  text(body, status) {
    return new Response(body, { status: status || 200 });
  }
  redirect(url, status) {
    return new Response(null, { status: status || 302, headers: { Location: url } });
  }
}

/** Gabung 2 segmen path jadi 1, tanpa dobel '/' atau '/' hilang. */
function joinPaths(a, b) {
  const left = a.replace(/\/+$/, '');
  const right = b.replace(/^\/+/, '');
  if (!left) return '/' + right;
  if (!right) return left || '/';
  return `${left}/${right}`;
}

function compilePattern(pattern) {
  // Dukung ':param' dan wildcard trailing '*'
  const paramNames = [];
  let isWildcard = false;
  const parts = pattern.split('/').filter((p) => p !== '');
  const regexParts = parts.map((part) => {
    if (part === '*') {
      isWildcard = true;
      return '.*';
    }
    if (part.startsWith(':')) {
      paramNames.push(part.slice(1));
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp('^/' + regexParts.join('/') + (isWildcard ? '' : '/?') + '$');
  return { regex, paramNames };
}

export class Hono {
  constructor() {
    this.routes = [];
    this._notFound = (c) => c.json({ success: false, error: 'Not Found' }, 404);
    this._onError = (err, c) => {
      console.error(err);
      return c.json({ success: false, error: 'Internal Server Error' }, 500);
    };
  }
  _add(method, pattern, handlers) {
    const { regex, paramNames } = compilePattern(pattern);
    this.routes.push({ method, pattern, regex, paramNames, handlers });
  }
  get(pattern, ...handlers) { this._add('GET', pattern, handlers); }
  post(pattern, ...handlers) { this._add('POST', pattern, handlers); }
  put(pattern, ...handlers) { this._add('PUT', pattern, handlers); }
  delete(pattern, ...handlers) { this._add('DELETE', pattern, handlers); }
  use(_pattern, ...handlers) {
    // Middleware global — tidak dipakai versi lokal (CORS/geo dibuang),
    // tapi tetap didukung agar tidak error kalau dipanggil.
    this._globalMiddlewares = (this._globalMiddlewares || []).concat(handlers);
  }
  notFound(handler) { this._notFound = handler; }
  onError(handler) { this._onError = handler; }

  /**
   * Gabungkan semua route dari `subApp` (instance Hono lain) ke sini,
   * dengan `prefix` ditambahkan di depan tiap pattern-nya — sama seperti
   * `app.route(prefix, subApp)` di Hono asli. Dipakai untuk merakit
   * local-app.js dari modul-modul di routes/*.js.
   * Prefix '/' berarti tidak menambah apa pun (semua route project ini
   * sudah pakai path absolut sendiri, mis. '/api/produk/:id').
   */
  route(prefix, subApp) {
    for (const r of subApp.routes) {
      const combined = joinPaths(prefix, r.pattern);
      const { regex, paramNames } = compilePattern(combined);
      this.routes.push({ method: r.method, pattern: combined, regex, paramNames, handlers: r.handlers });
    }
  }

  async fetch(rawRequest, env) {
    const url = new URL(rawRequest.url);
    let matched = null;
    let params = {};
    for (const route of this.routes) {
      if (route.method !== rawRequest.method) continue;
      const m = route.regex.exec(url.pathname);
      if (m) {
        matched = route;
        route.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
        break;
      }
    }
    const c = new Context(rawRequest, params, url, env);
    const handlers = (this._globalMiddlewares || []).concat(matched ? matched.handlers : []);

    try {
      if (!matched) {
        const res = await this._notFound(c);
        return res instanceof Response ? res : c.json({ success: false, error: 'Not Found' }, 404);
      }
      let idx = -1;
      const dispatch = async (i) => {
        if (i <= idx) throw new Error('next() called multiple times');
        idx = i;
        const fn = handlers[i];
        if (!fn) return c.res;
        const result = await fn(c, () => dispatch(i + 1));
        if (result instanceof Response) c.res = result;
        return c.res;
      };
      const res = await dispatch(0);
      return res instanceof Response ? res : c.json({ success: false, error: 'No response' }, 500);
    } catch (err) {
      const res = await this._onError(err, c);
      return res instanceof Response ? res : c.json({ success: false, error: 'Internal Server Error' }, 500);
    }
  }
}
