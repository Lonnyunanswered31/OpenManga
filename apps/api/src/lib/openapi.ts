import { z } from "zod";

type Doc = {
  method: string;
  path: string;
  summary: string;
  tag: string;
  body?: z.ZodType;
  query?: z.ZodType;
  auth?: boolean;
};
const registry: Doc[] = [];

/** Register an endpoint for OpenAPI. Schemas are the same Zod schemas used for runtime validation. */
export function doc(d: Doc) {
  registry.push(d);
}

export function openApiSpec(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const d of registry) {
    const p = d.path.replace(/:(\w+)/g, "{$1}");
    const params = [...d.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (d.query) {
      const js = z.toJSONSchema(d.query, { io: "input", unrepresentable: "any" }) as {
        properties?: Record<string, unknown>;
      };
      for (const [name, schema] of Object.entries(js.properties ?? {}))
        params.push({ name, in: "query", required: false, schema: schema as { type: string } });
    }
    paths[p] ??= {};
    paths[p][d.method.toLowerCase()] = {
      summary: d.summary,
      tags: [d.tag],
      parameters: params,
      ...(d.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: z.toJSONSchema(d.body, { io: "input", unrepresentable: "any" }) },
              },
            },
          }
        : {}),
      responses: {
        "200": { description: "OK" },
        "4XX": { description: "Error envelope { error: { code, message, requestId } }" },
      },
      ...(d.auth === false ? {} : { security: [{ cookieAuth: [] }] }),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenManga API",
      version: "1.0.0",
      description: "Unsafe methods require the x-csrf-token header matching the om_csrf cookie.",
    },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "om_session" } } },
    paths,
  };
}

export function docsHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpenManga API</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1100px;color:#222}h2{margin-top:2rem;border-bottom:1px solid #ddd}code{background:#f3f3f3;padding:2px 4px;border-radius:4px}.m{display:inline-block;width:64px;font-weight:700}.get{color:#0a7}.post{color:#07c}.patch{color:#a60}.put{color:#a60}.delete{color:#c33}details{margin:.25rem 0}pre{background:#f7f7f7;padding:.5rem;overflow:auto}</style></head>
<body><h1>OpenManga API</h1><p>Raw spec: <a href="docs/openapi.json">openapi.json</a></p><div id="out">Loading…</div>
<script>
fetch("docs/openapi.json").then(r=>r.json()).then(s=>{const by={};for(const[p,ms]of Object.entries(s.paths))for(const[m,o]of Object.entries(ms))(by[o.tags[0]]??=[]).push([m,p,o]);
const esc=t=>String(t).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
document.getElementById("out").innerHTML=Object.entries(by).map(([t,rs])=>"<h2>"+esc(t)+"</h2>"+rs.map(([m,p,o])=>"<details><summary><span class='m "+m+"'>"+m.toUpperCase()+"</span><code>"+esc(p)+"</code> "+esc(o.summary)+"</summary>"+(o.requestBody?"<pre>"+esc(JSON.stringify(o.requestBody.content["application/json"].schema,null,2))+"</pre>":"")+"</details>").join("")).join("")});
</script></body></html>`;
}
