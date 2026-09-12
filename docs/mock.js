const data = JSON.parse(document.getElementById('demo-data').textContent);
const templates = { ...data.templates };
const order = Object.keys(templates);

const named = (body, bucket) => {
  try {
    const name = JSON.parse(JSON.parse(body).json).name;
    return data[bucket][name] ?? Object.values(data[bucket])[0];
  } catch {
    return Object.values(data[bucket])[0];
  }
};

const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

const realFetch = window.fetch.bind(window);

window.fetch = async (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api')) return realFetch(input, options);

  const path = url.replace(/^\/api/, '');
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body;

  if (path === '/session') return json(data.session);
  if (path === '/state') return json({ ...data.state, templates: order.map((id) => data.state.templates.find((t) => t.id === id)) });

  if (path === '/analyze') {
    const found = named(body, 'analyses');
    let role = null;
    try { role = JSON.parse(body).role; } catch {}
    const chosen = found.simulations[role] ?? Object.values(found.simulations)[0];
    return json({ findings: found.findings, counts: found.counts, roles: found.roles, simulation: chosen });
  }

  if (path === '/compare') return json(named(body, 'comparisons'));

  if (path === '/plan') {
    const plan = named(body, 'plans');
    return json({ plans: [plan], ...plan });
  }

  if (path === '/apply') {
    return json({
      results: [{ guildId: '1', guildName: 'Mijn Testserver', applied: 0, failed: 0, errors: [], note: 'demo — er is niets gewijzigd' }],
      applied: 0, failed: 0, errors: [],
    });
  }

  const templateMatch = path.match(/^\/templates\/([\w-]+)(\/(\w+))?$/);
  if (templateMatch) {
    const [, id, , sub] = templateMatch;
    if (sub === 'versions') return json({ versions: [] });
    if (method === 'PUT') {
      templates[id] = { ...templates[id], json: JSON.parse(body).json };
      return json({ id, saved: true });
    }
    if (method === 'DELETE') return json({ deleted: id });
    return json(templates[id] ?? Object.values(templates)[0]);
  }

  if (path === '/templates' && method === 'POST') {
    return json({ id: order[0], json: templates[order[0]].json });
  }

  if (path.startsWith('/export/')) {
    return json({ id: 'mijn-testserver', json: templates[order[0]].json });
  }

  if (path.startsWith('/backups/')) {
    return json({ applied: 0, failed: 0, errors: [], note: 'demo — er is niets teruggezet' });
  }

  return json({ error: 'Niet beschikbaar in de demo.' });
};
