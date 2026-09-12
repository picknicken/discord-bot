import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compare } from '../src/compare.js';
import { auditSummary, countBySeverity, lintTemplate } from '../src/lint.js';
import { PERMISSION_CATALOGUE } from '../src/permissionCatalogue.js';
import { ONDERDELEN, onderdeelVan, UITLEG } from '../src/onderdelen.js';
import { describeActions, planSetup, summarizePlan } from '../src/planner.js';
import { simulate, simulatableRoles } from '../src/simulate.js';
import type { GuildSnapshot, SnapshotChannel } from '../src/snapshot.js';
import { loadAllTemplates } from '../src/templates.js';

/**
 * Bouwt een statische demo van het dashboard: dezelfde pagina en dezelfde
 * scripts, maar met een nagebootste server ervoor. Alles wat de echte API zou
 * antwoorden wordt hier vooraf uitgerekend, zodat de demo op GitHub Pages of in
 * een browser kan draaien zonder bot, zonder token en zonder Node.
 */

const SOURCE = 'src/dashboard';
const OUT = 'docs';   // GitHub Pages kan deze map met een schakelaar serveren

/** Een verzonnen server die deels op de community-template lijkt. */
const channel = (id: string, name: string, parentId: string | null, type: SnapshotChannel['type'] = 'text'): SnapshotChannel => ({
  id, name, type, parentId, topic: null, nsfw: false, slowmodeSeconds: 0, userLimit: null, position: 0,
});

const demoSnapshot: GuildSnapshot = {
  id: '1',
  name: 'Mijn Testserver',
  roles: [
    { id: '1', name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 0, managed: false, isEveryone: true },
    { id: '2', name: 'Lid', color: 0x57f287, hoist: false, mentionable: false, permissions: 0n, position: 1, managed: false, isEveryone: false },
    { id: '3', name: 'Oud-lid', color: 0x99aab5, hoist: false, mentionable: false, permissions: 0n, position: 2, managed: false, isEveryone: false },
  ],
  categories: [
    { id: '10', name: 'Welkom', position: 0 },
    { id: '11', name: 'Gesprekken', position: 1 },
    { id: '12', name: 'Archief', position: 2 },
  ],
  channels: [
    channel('20', 'welkom', '10'),
    channel('21', 'algemeen', '11'),
    channel('22', 'oude-memes', '11'),
    channel('23', 'stof', '12'),
  ],
  emojis: [],
  automod: [],
};

const demoGuilds = [
  { id: '1', name: 'Mijn Testserver', iconUrl: null, memberCount: 428, channelCount: 7, roleCount: 2, missing: [] as string[], rolesAbove: 0 },
  { id: '2', name: 'Clan Server', iconUrl: null, memberCount: 76, channelCount: 3, roleCount: 1, missing: ['ManageRoles'], rolesAbove: 2 },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const templates = await loadAllTemplates('./templates');

  const data = {
    session: {
      authEnabled: true,
      authenticated: true,
      user: { id: '0', username: 'jij', globalName: 'Jij', avatarUrl: 'logo.png' },
      guilds: [
        { id: '1', name: 'Mijn Testserver', iconUrl: null, owner: true, canManage: true, botPresent: true, inviteUrl: null },
        { id: '3', name: 'Vriendengroep', iconUrl: null, owner: true, canManage: true, botPresent: false, inviteUrl: 'https://discord.com/oauth2/authorize' },
      ],
    },
    state: {
      botName: 'Setup Bot',
      botId: '0',
      avatarUrl: 'logo.png',
      templatesDir: './templates',
      guilds: demoGuilds,
      permissions: PERMISSION_CATALOGUE,
      onderdelen: ONDERDELEN.map((onderdeel) => ({ naam: onderdeel, uitleg: UITLEG[onderdeel] })),
      backups: [
        { file: 'demo-1.json', guildId: '1', guildName: 'Mijn Testserver', createdAt: '2026-09-10T14:02:00.000Z', roles: 2, channels: 4 },
      ],
      templates: templates.map(({ id, template }) => ({
        id,
        name: template.name,
        description: template.description,
        roles: template.roles.length,
        categories: template.categories.length,
        channels:
          template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
          template.uncategorizedChannels.length,
        error: null,
      })),
    },
    templates: Object.fromEntries(
      templates.map(({ id, template }) => [id, { id, json: JSON.stringify(template, null, 2), template }]),
    ),
    /** Vooraf uitgerekend per template en per rol; de demo rekent niets zelf uit. */
    analyses: Object.fromEntries(
      templates.map(({ template }) => {
        const findings = lintTemplate(template);
        const roles = simulatableRoles(template);
        return [
          template.name,
          {
            findings,
            counts: countBySeverity(findings),
            summary: auditSummary(template),
            roles,
            simulations: Object.fromEntries(roles.map((role) => [role.key, simulate(template, role.key)])),
          },
        ];
      }),
    ),
    comparisons: Object.fromEntries(
      templates.map(({ template }) => [template.name, compare(demoSnapshot, template)]),
    ),
    plans: Object.fromEntries(
      templates.map(({ template }) => {
        const plan = planSetup(demoSnapshot, template, { prune: false, update: true });
        return [
          template.name,
          {
            guildId: '1',
            guildName: 'Mijn Testserver',
            summary: summarizePlan(plan),
            actions: describeActions(plan, 1000),
            // Bij elke regel het onderdeel, zodat de demo de vinkjes echt volgt.
            onderdeelPerActie: plan.actions.map((action) => onderdeelVan(action)),
            warnings: plan.warnings,
            count: plan.actions.length,
          },
        ];
      }),
    ),
  };

  // De gegevens gaan in de pagina zelf. Een los bestand moet opgehaald worden met
  // een relatief pad, en dat wijst de verkeerde kant op zodra de pagina onder een
  // ander adres hangt dan verwacht.
  const inlineData =
    '<script type="application/json" id="demo-data">' +
    JSON.stringify(data).replace(/</g, '\\u003c') +
    '</' + 'script>';

  await copyFile('assets/logo.png', path.join(OUT, 'logo.png'));

  // Alles in een script in de pagina. Losse modulebestanden worden met CORS
  // opgehaald, en in een afgeschermde iframe (oorsprong "null") weigert de
  // browser dat - dan draait er niets. Inline modules worden niet opgehaald.
  const bundel = await bundleScripts();

  const page = await readFile(path.join(SOURCE, 'index.html'), 'utf8');
  const withMock = page
    .replace('<title>Setup Bot — dashboard</title>', '<title>Setup Bot Dashboard</title>')
    .replace(
      '<script type="module" src="app.js"></script>',
      banner() + '\n' + inlineData + '\n<script type="module">\n' + bundel + '\n</' + 'script>',
    );

  await writeFile(path.join(OUT, 'index.html'), withMock, 'utf8');

  // Variant zonder <html>/<head>/<body> voor plekken die de pagina zelf inpakken.
  const inner = withMock
    .replace(/^[\s\S]*?<head>\n/, '')
    .replace('</head>\n<body>\n', '')
    .replace(/<\/body>\s*<\/html>\s*$/, '');
  await writeFile(path.join(OUT, 'embed.html'), inner, 'utf8');

  console.log(`demo gebouwd in ${OUT}/ — ${templates.length} templates, ${PERMISSION_CATALOGUE.length} permissies`);
}

/**
 * Voegt de dashboardscripts samen tot een module. De import-regels vervallen -
 * alles staat in dezelfde scope - behalve waar een naam hernoemd werd; die
 * krijgt een eigen regel terug, anders wijst hij naar iets anders.
 */
async function bundleScripts(): Promise<string> {
  const delen: string[] = [];

  for (const file of ['ui.js', 'editor.js', '__mock__', 'app.js']) {
    const bron = file === '__mock__' ? mockScript() : await readFile(path.join(SOURCE, file), 'utf8');

    const schoon = bron
      .split('\n')
      .flatMap((regel) => {
        const invoer = regel.match(/^import\s+\{([^}]+)\}\s+from\s+'[^']+';$/);
        if (invoer) {
          return (invoer[1] ?? '')
            .split(',')
            .map((naam) => naam.trim().match(/^(\w+)\s+as\s+(\w+)$/))
            .filter((hernoemd): hernoemd is RegExpMatchArray => hernoemd !== null)
            .map((hernoemd) => `const ${hernoemd[2]} = ${hernoemd[1]};`);
        }
        if (/^import\s+/.test(regel)) return [];
        return [regel.replace(/^export\s+(?=(function|const|class|let)\s)/, '')];
      })
      .join('\n');

    delen.push(`// ---- ${file} ----\n${schoon}`);
  }

  return delen.join('\n\n');
}

function banner(): string {
  // De balk staat onder de navigatie, niet erover: anders vangt hij de tikken
  // op de knoppen onderin op en kun je op een telefoon nergens meer heen.
  return `<div class="demobalk">
  Demo met verzonnen gegevens — er is geen bot verbonden en er verandert niets aan een echte server.
</div>
<style>
  .demobalk {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 25;
    background: var(--accent); color: #fff; text-align: center;
    font: 12.5px/1.5 system-ui, sans-serif; padding: 7px 14px;
  }
  .grid { padding-bottom: 64px; }
  @media (max-width: 900px) {
    .mobilenav { bottom: 54px; z-index: 40; }
    .grid { padding-bottom: 140px; }
  }
</style>`;
}

/** Onderschept fetch en beantwoordt de dashboard-API uit het vooraf gebouwde bestand. */
function mockScript(): string {
  return `const data = JSON.parse(document.getElementById('demo-data').textContent);
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

  const path = url.replace(/^\\/api/, '');
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body;

  if (path === '/session') return json(data.session);
  if (path === '/state') return json({ ...data.state, templates: order.map((id) => data.state.templates.find((t) => t.id === id)) });

  if (path === '/analyze') {
    const found = named(body, 'analyses');
    let role = null;
    try { role = JSON.parse(body).role; } catch {}
    const chosen = found.simulations[role] ?? Object.values(found.simulations)[0];
    return json({
      findings: found.findings, counts: found.counts, summary: found.summary,
      roles: found.roles, simulation: chosen,
    });
  }

  if (path === '/compare') return json(named(body, 'comparisons'));

  if (path === '/plan') {
    const plan = named(body, 'plans');
    const keuze = JSON.parse(body || '{}').onderdelen;

    if (Array.isArray(keuze) && keuze.length < data.state.onderdelen.length) {
      const regels = plan.actions.filter((_, i) => keuze.includes(plan.onderdeelPerActie[i]));
      const uit = data.state.onderdelen.map((o) => o.naam).filter((naam) => !keuze.includes(naam));
      const gefilterd = {
        ...plan,
        actions: regels,
        count: regels.length,
        summary: regels.length + ' acties in: ' + keuze.join(', '),
        warnings: [...plan.warnings, 'Niet meegenomen: ' + uit.join(', ') + '.'],
      };
      return json({ plans: [gefilterd], ...gefilterd });
    }

    return json({ plans: [plan], ...plan });
  }

  if (path === '/apply') {
    return json({
      results: [{ guildId: '1', guildName: 'Mijn Testserver', applied: 0, failed: 0, errors: [], note: 'demo — er is niets gewijzigd' }],
      applied: 0, failed: 0, errors: [],
    });
  }

  const templateMatch = path.match(/^\\/templates\\/([\\w-]+)(\\/(\\w+))?$/);
  if (templateMatch) {
    const [, id, , sub] = templateMatch;
    if (sub === 'versions') {
      // Verzonnen geschiedenis, zodat je in de demo ziet hoe het eruitziet.
      return json({ versions: [
        { stamp: '2026-09-11T09-14-02-000Z', createdAt: '2026-09-11T09:14:02.000Z', size: 0, door: 'Jij', summary: '1 kanaal erbij \u00b7 1 rol aangepast' },
        { stamp: '2026-09-10T16-40-55-000Z', createdAt: '2026-09-10T16:40:55.000Z', size: 0, door: 'Jij', summary: '2 kanalen erbij' },
      ] });
    }
    if (sub === 'version') return json({ json: templates[id]?.json ?? Object.values(templates)[0].json });
    if (sub === 'restore') return json({ error: 'In de demo zetten we niets terug.' });
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
`;
}

await main();
