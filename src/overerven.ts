/**
 * Templates die op elkaar voortbouwen.
 *
 * De meeste servers lijken op elkaar. Wie een tweede community-server opzet wil
 * meestal precies de eerste, met één categorie erbij en een andere kleur voor de
 * rol van het team. Dat kon tot nu toe alleen door de hele template te kopiëren,
 * en dan heb je twee bestanden van vierhonderd regels die langzaam uit elkaar
 * lopen: een verbetering in de ene komt nooit meer in de andere terecht.
 *
 * Met `"basis": "community"` zegt een template: neem alles van community, en wat
 * hieronder staat is wat er anders is. De basis blijft dus één plek om te
 * onderhouden.
 *
 * Alles gebeurt op de ruwe JSON, vóór de controle en vóór het invullen van de
 * variabelen. Zo ziet de rest van de bot straks gewoon één complete template en
 * hoeft er verder niets van overerving te weten.
 */

export type Ruw = Record<string, unknown>;

/**
 * Lijsten waarvan elk item zichzelf benoemt. Die horen samengevoegd te worden op
 * die naam, niet vervangen: anders moet je de hele rollenlijst overschrijven om
 * één kleur aan te passen, en dan heb je alsnog een kopie.
 *
 * Wat hier níét in staat (permissies, keywords, de opties van een onboardingvraag)
 * is een lijst met waarden in plaats van dingen. Daar is "wat het kind opgeeft"
 * het hele antwoord, want half overnemen levert een lijst op die niemand bedoeld
 * heeft.
 */
const SLEUTEL: Record<string, string> = {
  roles: 'key',
  categories: 'name',
  channels: 'name',
  uncategorizedChannels: 'name',
  emojis: 'name',
  automod: 'name',
  overwrites: 'role',
};

/** Welke lijsten je met `verwijder` kunt opruimen, en waar ze staan. */
const VERWIJDERBAAR = ['roles', 'categories', 'channels', 'uncategorizedChannels', 'emojis', 'automod'];

function isObject(waarde: unknown): waarde is Ruw {
  return typeof waarde === 'object' && waarde !== null && !Array.isArray(waarde);
}

function naamVan(item: unknown, sleutel: string): unknown {
  return isObject(item) ? item[sleutel] : undefined;
}

function samenLijst(basis: readonly unknown[], kind: readonly unknown[], sleutel: string): unknown[] {
  const uit = [...basis];

  for (const item of kind) {
    const naam = naamVan(item, sleutel);
    const index = naam === undefined ? -1 : uit.findIndex((oud) => naamVan(oud, sleutel) === naam);
    const oud = index >= 0 ? uit[index] : undefined;

    if (index >= 0 && isObject(oud) && isObject(item)) uit[index] = samenObject(oud, item);
    else if (index >= 0) uit[index] = item;
    else uit.push(item);
  }

  return uit;
}

function samenObject(basis: Ruw, kind: Ruw): Ruw {
  const uit: Ruw = { ...basis };

  for (const [naam, waarde] of Object.entries(kind)) {
    const oud = uit[naam];
    const sleutel = SLEUTEL[naam];

    if (sleutel !== undefined && Array.isArray(oud) && Array.isArray(waarde)) {
      uit[naam] = samenLijst(oud, waarde, sleutel);
    } else if (isObject(oud) && isObject(waarde)) {
      uit[naam] = samenObject(oud, waarde);
    } else {
      uit[naam] = waarde;
    }
  }

  return uit;
}

/** Een kanaal met deze naam weghalen, waar het ook staat. */
function zonderKanaal(template: Ruw, naam: string): boolean {
  let gevonden = false;

  const weg = (lijst: unknown): unknown => {
    if (!Array.isArray(lijst)) return lijst;
    const over = lijst.filter((kanaal) => naamVan(kanaal, 'name') !== naam);
    if (over.length !== lijst.length) gevonden = true;
    return over;
  };

  template['uncategorizedChannels'] = weg(template['uncategorizedChannels']);
  const categorieen = template['categories'];
  if (Array.isArray(categorieen)) {
    for (const categorie of categorieen) {
      if (isObject(categorie)) categorie['channels'] = weg(categorie['channels']);
    }
  }

  return gevonden;
}

/**
 * Wat de basis wél heeft en deze template niet wil.
 *
 * Een onbekende naam is een fout en geen stilte: hij betekent bijna altijd dat de
 * basis veranderd is en dat deze template achterloopt, en dat wil je horen op het
 * moment dat je hem opslaat - niet pas als er een rol terugkomt die je jaren
 * geleden hebt weggehaald.
 */
export function verwijderUit(template: Ruw, verwijder: Ruw): Ruw {
  const uit: Ruw = { ...template };

  for (const [soort, namen] of Object.entries(verwijder)) {
    if (!VERWIJDERBAAR.includes(soort)) {
      throw new Error(
        `verwijder kent "${soort}" niet. Dit kan: ${VERWIJDERBAAR.join(', ')}.`,
      );
    }
    if (!Array.isArray(namen)) {
      throw new Error(`verwijder.${soort} moet een lijst met namen zijn.`);
    }

    for (const naam of namen) {
      if (typeof naam !== 'string') throw new Error(`verwijder.${soort} moet namen bevatten.`);

      if (soort === 'channels') {
        if (!zonderKanaal(uit, naam)) {
          throw new Error(`verwijder.channels: er is geen kanaal "${naam}" in de basis.`);
        }
        continue;
      }

      const sleutel = SLEUTEL[soort] ?? 'name';
      const lijst = uit[soort];
      if (!Array.isArray(lijst)) {
        throw new Error(`verwijder.${soort}: de basis heeft geen ${soort}.`);
      }

      const over = lijst.filter((item) => naamVan(item, sleutel) !== naam);
      if (over.length === lijst.length) {
        throw new Error(`verwijder.${soort}: "${naam}" staat niet in de basis.`);
      }
      uit[soort] = over;
    }
  }

  return uit;
}

/**
 * De basis en wat erop voortbouwt tot één template.
 *
 * De volgorde is die van de basis: wat de basis al kent blijft staan waar het
 * stond, nieuwe dingen komen erachteraan. Dat is te overzien, en het voorkomt dat
 * een kanaal van plek springt doordat het toevallig ook in het kind genoemd wordt.
 */
export function bouwOp(basis: Ruw, kind: Ruw): Ruw {
  const { basis: _basis, verwijder, ...rest } = kind;

  if (verwijder !== undefined && !isObject(verwijder)) {
    throw new Error('verwijder moet een object zijn, bijvoorbeeld {"roles": ["vip"]}.');
  }

  const opgeruimd = verwijder === undefined ? basis : verwijderUit(basis, verwijder);
  return samenObject(opgeruimd, rest);
}

/** Bouwt deze template voort op een andere? */
export function basisVan(data: unknown): string | null {
  if (!isObject(data)) return null;
  const basis = data['basis'];
  if (basis === undefined || basis === null) return null;
  if (typeof basis !== 'string' || !/^[\w-]+$/.test(basis)) {
    throw new Error(`"basis" moet de naam van een andere template zijn, zoals "community".`);
  }
  return basis;
}

/** Diep vergelijken, zonder te struikelen over de volgorde van de sleutels. */
export function gelijk(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => gelijk(item, b[index]));
  }

  if (isObject(a) && isObject(b)) {
    // Een sleutel zonder waarde telt niet mee: in JSON is die niet te
    // onderscheiden van een sleutel die er niet staat, en daar gaat dit over.
    const namen = Object.keys(a).filter((naam) => a[naam] !== undefined);
    const andere = Object.keys(b).filter((naam) => b[naam] !== undefined);
    if (namen.length !== andere.length) return false;
    return namen.every((naam) => gelijk(a[naam], b[naam]));
  }

  return false;
}

function verschilLijst(basis: readonly unknown[], volledig: readonly unknown[], sleutel: string): unknown[] {
  const uit: unknown[] = [];

  for (const item of volledig) {
    const naam = naamVan(item, sleutel);
    const oud = naam === undefined ? undefined : basis.find((kandidaat) => naamVan(kandidaat, sleutel) === naam);

    if (oud === undefined) uit.push(item);
    else if (gelijk(oud, item)) continue;
    else if (isObject(oud) && isObject(item)) uit.push({ [sleutel]: naam, ...verschilObject(oud, item) });
    else uit.push(item);
  }

  return uit;
}

function verschilObject(basis: Ruw, volledig: Ruw): Ruw {
  const uit: Ruw = {};

  for (const [naam, waarde] of Object.entries(volledig)) {
    const oud = basis[naam];
    if (gelijk(oud, waarde)) continue;

    const sleutel = SLEUTEL[naam];
    if (sleutel !== undefined && Array.isArray(oud) && Array.isArray(waarde)) {
      const lijst = verschilLijst(oud, waarde, sleutel);
      if (lijst.length > 0) uit[naam] = lijst;
      continue;
    }

    if (isObject(oud) && isObject(waarde)) {
      const dieper = verschilObject(oud, waarde);
      if (Object.keys(dieper).length > 0) uit[naam] = dieper;
      continue;
    }

    uit[naam] = waarde;
  }

  return uit;
}

/** Alle kanaalnamen in een template, waar ze ook staan. */
function kanaalNamen(template: Ruw): string[] {
  const namen: string[] = [];

  const lees = (lijst: unknown): void => {
    if (!Array.isArray(lijst)) return;
    for (const kanaal of lijst) {
      const naam = naamVan(kanaal, 'name');
      if (typeof naam === 'string') namen.push(naam);
    }
  };

  lees(template['uncategorizedChannels']);
  const categorieen = template['categories'];
  if (Array.isArray(categorieen)) for (const categorie of categorieen) if (isObject(categorie)) lees(categorie['channels']);

  return namen;
}

/**
 * De andere kant op: wat moet er in het kind staan om van de basis bij deze
 * volledige template uit te komen?
 *
 * Nodig zodra er iets terugschrijft naar een template die op een basis
 * voortbouwt - het overnemen van een server bijvoorbeeld. Zonder dit zou daar de
 * complete samengevoegde template in het bestand belanden, en dan is de basis
 * stilletjes weg.
 *
 * Niet alles is uit te drukken: een kanaal dat van categorie wisselt, of een
 * andere volgorde dan de basis, past niet in "de basis plus verschillen". Daarom
 * is dit alleen te vertrouwen als je het antwoord teruglegt - bouwOp(basis, kind)
 * hoort weer precies het origineel te geven, en past()  controleert dat.
 */
export function alleenVerschil(basis: Ruw, volledig: Ruw): Ruw {
  const kind = verschilObject(basis, volledig);
  const verwijder: Ruw = {};

  for (const soort of VERWIJDERBAAR) {
    if (soort === 'channels') {
      const heeft = new Set(kanaalNamen(volledig));
      const weg = kanaalNamen(basis).filter((naam) => !heeft.has(naam));
      if (weg.length > 0) verwijder['channels'] = weg;
      continue;
    }

    const oud = basis[soort];
    const nieuw = volledig[soort];
    if (!Array.isArray(oud) || !Array.isArray(nieuw)) continue;

    const sleutel = SLEUTEL[soort] ?? 'name';
    const heeft = new Set(nieuw.map((item) => naamVan(item, sleutel)));
    const weg = oud.map((item) => naamVan(item, sleutel)).filter((naam) => naam !== undefined && !heeft.has(naam));
    if (weg.length > 0) verwijder[soort] = weg;
  }

  // Een categorie die weggaat neemt zijn kanalen mee; die hoeven er niet nog
  // eens apart bij te staan.
  const wegCategorieen = new Set((verwijder['categories'] as unknown[] | undefined) ?? []);
  if (wegCategorieen.size > 0 && Array.isArray(verwijder['channels'])) {
    const inWeg = new Set<string>();
    const categorieen = basis['categories'];
    if (Array.isArray(categorieen)) {
      for (const categorie of categorieen) {
        if (isObject(categorie) && wegCategorieen.has(naamVan(categorie, 'name'))) {
          for (const naam of kanaalNamen({ categories: [categorie] })) inWeg.add(naam);
        }
      }
    }
    const over = (verwijder['channels'] as unknown[]).filter((naam) => !inWeg.has(String(naam)));
    if (over.length > 0) verwijder['channels'] = over;
    else delete verwijder['channels'];
  }

  return { ...kind, ...(Object.keys(verwijder).length > 0 ? { verwijder } : {}) };
}

/**
 * Waar lopen twee templates uiteen? Alleen de eerste plek, met het pad erheen -
 * genoeg om te zeggen wát er niet past, en korter dan twee keer de hele JSON.
 */
export function eersteVerschil(a: unknown, b: unknown, pad = ''): string | null {
  if (gelijk(a, b)) return null;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${pad} (${a.length} tegen ${b.length})`;
    for (const [index, item] of a.entries()) {
      const dieper = eersteVerschil(item, b[index], `${pad}[${index}]`);
      if (dieper !== null) return dieper;
    }
    return pad;
  }

  if (isObject(a) && isObject(b)) {
    for (const naam of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const dieper = eersteVerschil(a[naam], b[naam], pad === '' ? naam : `${pad}.${naam}`);
      if (dieper !== null) return dieper;
    }
    return pad;
  }

  return pad === '' ? '(de hele template)' : pad;
}

/** Levert het kind samen met de basis weer precies het origineel op? */
export function past(basis: Ruw, kind: Ruw, volledig: Ruw): boolean {
  try {
    return gelijk(bouwOp(basis, kind), volledig);
  } catch {
    return false;
  }
}
