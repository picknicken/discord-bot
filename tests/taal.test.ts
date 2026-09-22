import { describe, expect, it } from 'vitest';
import { kiesTaal, SLEUTELS, t } from '../src/taal.js';

/**
 * De bot praat met leden, en die spreken lang niet allemaal Nederlands. Discord
 * weet al in welke taal iemand zit; dit is de vertaalslag daarvan.
 */

describe('welke taal', () => {
  it('kiest Nederlands bij een Nederlandse Discord', () => {
    expect(kiesTaal('nl')).toBe('nl');
  });

  it('herkent ook een landvariant', () => {
    expect(kiesTaal('nl-NL')).toBe('nl');
  });

  it('kiest Engels bij Engels', () => {
    expect(kiesTaal('en-US')).toBe('en');
    expect(kiesTaal('en-GB')).toBe('en');
  });

  it('kiest Engels bij een taal die we niet spreken', () => {
    // Wie Duits in Discord heeft staan begrijpt het Engels wel, en het
    // Nederlands vrijwel zeker niet.
    expect(kiesTaal('de')).toBe('en');
    expect(kiesTaal('fr')).toBe('en');
  });

  it('kiest Engels als Discord niets zegt', () => {
    expect(kiesTaal(undefined)).toBe('en');
    expect(kiesTaal(null)).toBe('en');
    expect(kiesTaal('')).toBe('en');
  });
});

describe('de teksten', () => {
  it('vult waarden in', () => {
    expect(t('nl', 'rolmenu.erbij', { rol: 'PC' })).toBe('Je hebt nu **PC**.');
    expect(t('en', 'rolmenu.erbij', { rol: 'PC' })).toBe('You now have **PC**.');
  });

  it('laat een waarde die niemand meegaf gewoon staan', () => {
    // Zichtbaar kapot is beter dan een halve zin waar niemand meer aan ziet
    // dat er iets mist.
    expect(t('nl', 'rolmenu.erbij')).toContain('{rol}');
  });

  it('heeft in beide talen dezelfde invulvelden', () => {
    const velden = (tekst: string) => [...tekst.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (const sleutel of SLEUTELS) {
      expect(velden(t('nl', sleutel)), `${sleutel} nl`).toEqual(velden(t('en', sleutel)));
    }
  });

  it('heeft nergens een lege tekst', () => {
    for (const sleutel of SLEUTELS) {
      expect(t('nl', sleutel).trim(), `${sleutel} nl`).not.toBe('');
      expect(t('en', sleutel).trim(), `${sleutel} en`).not.toBe('');
    }
  });

  it('verwijst in het Engels naar de Engelse commandonaam', () => {
    // /clan koppel heet in het Engels /clan link; een tip die naar het
    // verkeerde commando wijst is erger dan geen tip.
    expect(t('en', 'mij.geenkoppeling')).toContain('/clan link');
    expect(t('nl', 'mij.geenkoppeling')).toContain('/clan koppel');
  });
});
