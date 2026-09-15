import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aangegevenVariabelen,
  beschrijfVariabelen,
  gebruikteVariabelen,
  leesWaarden,
  uitlegOntbrekend,
  vulVariabelenIn,
} from '../src/variabelen.js';
import { loadTemplate, loadTemplateMet } from '../src/templates.js';

const sjabloon = JSON.stringify({
  name: '{{clan}} server',
  variables: {
    clan: { beschrijving: 'Naam van je clan' },
    kleur: { beschrijving: 'Hoofdkleur', standaard: '#5865F2' },
  },
  roles: [{ key: 'staf', name: '{{clan}} Staff', color: '{{kleur}}' }],
  categories: [{ name: 'Info', channels: [{ name: 'welkom' }] }],
});

describe('variabelen vinden en invullen', () => {
  it('vindt elke naam één keer', () => {
    expect(gebruikteVariabelen(sjabloon)).toEqual(['clan', 'kleur']);
  });

  it('leest wat de template zelf opgeeft', () => {
    expect(aangegevenVariabelen(sjabloon).kleur?.standaard).toBe('#5865F2');
  });

  it('vult in wat je meegeeft', () => {
    const uit = vulVariabelenIn(sjabloon, { clan: 'Bloody Mayhem' });
    expect(uit.json).toContain('"Bloody Mayhem Staff"');
    expect(uit.ontbrekend).toEqual([]);
  });

  it('gebruikt de standaard als je niets meegeeft', () => {
    expect(vulVariabelenIn(sjabloon, { clan: 'X' }).gebruikt.kleur).toBe('#5865F2');
  });

  it('laat de eigen waarde voorgaan op de standaard', () => {
    expect(vulVariabelenIn(sjabloon, { clan: 'X', kleur: '#ff0000' }).gebruikt.kleur).toBe('#ff0000');
  });

  it('meldt wat er ontbreekt in plaats van het te raden', () => {
    const uit = vulVariabelenIn(sjabloon, {});
    expect(uit.ontbrekend).toEqual(['clan']);
    expect(uit.json).toContain('{{clan}}');
  });

  it('meldt een waarde die de template niet kent, met een suggestie', () => {
    expect(vulVariabelenIn(sjabloon, { clan: 'X', kleru: 'rood' }).onbekend[0]).toContain('bedoelde je "kleur"?');
  });

  it('houdt het bestand geldig bij een waarde met aanhalingstekens', () => {
    const uit = vulVariabelenIn(sjabloon, { clan: 'De "Beste" \\ Clan' });
    expect(() => JSON.parse(uit.json)).not.toThrow();
    expect(JSON.parse(uit.json).name).toBe('De "Beste" \\ Clan server');
  });

  it('laat een template zonder variabelen met rust', () => {
    const kaal = JSON.stringify({ name: 'Gewoon' });
    expect(vulVariabelenIn(kaal, {}).json).toBe(kaal);
  });
});

describe('waarden lezen van de commandoregel', () => {
  it('leest naam=waarde', () => {
    expect(leesWaarden(['clan=Bloody Mayhem'])).toEqual({ clan: 'Bloody Mayhem' });
  });

  it('leest een lijstje met komma\'s', () => {
    expect(leesWaarden(['clan=X, kleur=#fff'])).toEqual({ clan: 'X', kleur: '#fff' });
  });

  it('negeert onzin zonder isgelijkteken', () => {
    expect(leesWaarden(['zomaar'])).toEqual({});
  });

  it('laat een waarde met een isgelijkteken erin heel', () => {
    expect(leesWaarden(['zin=a=b'])).toEqual({ zin: 'a=b' });
  });
});

describe('uitleg', () => {
  it('noemt wat er nodig is en hoe je het meegeeft', () => {
    const tekst = uitlegOntbrekend(['clan'], aangegevenVariabelen(sjabloon)).join('\n');
    expect(tekst).toContain('clan — Naam van je clan');
    expect(tekst).toContain('--var naam=waarde');
  });

  it('vat samen wat er is ingevuld', () => {
    expect(beschrijfVariabelen({ clan: 'X' })).toBe('Variabelen: clan="X".');
    expect(beschrijfVariabelen({})).toBe('');
  });
});

describe('een template met variabelen laden', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'templates-'));
    await writeFile(path.join(dir, 'clan.json'), sjabloon, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('vult in en controleert daarna gewoon de rest', async () => {
    const template = await loadTemplate(dir, 'clan', { clan: 'Bloody Mayhem' });
    expect(template.name).toBe('Bloody Mayhem server');
    expect(template.roles[0]?.name).toBe('Bloody Mayhem Staff');
    expect(template.roles[0]?.color).toBe('#5865F2');
  });

  it('weigert te laden zolang er een waarde mist', async () => {
    await expect(loadTemplate(dir, 'clan')).rejects.toThrow(/clan/);
  });

  it('geeft terug wat er is ingevuld', async () => {
    const geladen = await loadTemplateMet(dir, 'clan', { clan: 'X' });
    expect(geladen.gebruikt).toEqual({ clan: 'X', kleur: '#5865F2' });
  });
});

describe('losjes laden, voor een lijstje op het scherm', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'templates-losjes-'));
    await writeFile(path.join(dir, 'clan.json'), sjabloon, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('laadt zonder waarden, met de haakjes er nog in', async () => {
    const geladen = await loadTemplateMet(dir, 'clan', {}, { losjes: true });
    expect(geladen.template.roles[0]?.name).toBe('{{clan}} Staff');
  });

  it('houdt de opgegeven variabelen zichtbaar voor het scherm', async () => {
    const geladen = await loadTemplateMet(dir, 'clan', {}, { losjes: true });
    expect(Object.keys(geladen.template.variables)).toEqual(['clan', 'kleur']);
  });

  it('blijft streng als het menens wordt', async () => {
    await expect(loadTemplateMet(dir, 'clan', {}, { losjes: false })).rejects.toThrow(/clan/);
  });
});
