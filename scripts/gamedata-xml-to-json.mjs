#!/usr/bin/env node
// Zet Habbo's oude FigureData.xml / FigureMap.xml / EffectMap.xml om naar de
// JSON-vorm die de Nitro-client en de imager verwachten (avatar.figuredata.url,
// avatar.figuremap.url, avatar.effectmap.url).
//
// De mapping hier is overgenomen van billsonnn/nitro-converter (de officiele
// Nitro-conversietool, GPL-3.0), zodat de output exact hetzelfde formaat heeft
// als wat die tool produceert: src/common/mapping/mappers/{FigureData,FigureMap,EffectMap}Mapper.ts
// en src/common/mapping/xml/**.
//
// Gebruik:
//   node scripts/gamedata-xml-to-json.mjs --in ./gamedata-xml --out ./gamedata-json
//
// Standaard verwacht het script FigureData.xml, FigureMap.xml en EffectMap.xml
// in de input-map. Je kan per bestand ook een eigen pad of URL opgeven:
//   node scripts/gamedata-xml-to-json.mjs --figuredata-url https://.../figuredata.xml
//
// Staat een bron al in JSON? Dan wordt hij gewoon doorgezet (net als bij nitro-converter).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import xml2js from 'xml2js';

const { parseStringPromise } = xml2js;

// ---------------------------------------------------------------------------
// Kleine helpers voor het lezen van xml2js-attributen ($ = attributen, _ = tekst)
// ---------------------------------------------------------------------------

function num(attrs, key, fallback = 0) {
    if (!attrs || attrs[key] === undefined) return fallback;
    const parsed = parseInt(attrs[key], 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function bool01(attrs, key, fallback = false) {
    if (!attrs || attrs[key] === undefined) return fallback;
    return parseInt(attrs[key], 10) === 1;
}

function str(attrs, key, fallback = '') {
    if (!attrs || attrs[key] === undefined) return fallback;
    return attrs[key];
}

// ---------------------------------------------------------------------------
// FigureData.xml -> FigureData.json
// ---------------------------------------------------------------------------

function mapColor(node) {
    const attrs = node.$;

    return {
        id: num(attrs, 'id'),
        index: num(attrs, 'index'),
        club: num(attrs, 'club'),
        selectable: bool01(attrs, 'selectable'),
        hexCode: node._ ?? ''
    };
}

function mapPalette(node) {
    const palette = { id: num(node.$, 'id') };

    if (Array.isArray(node.color)) palette.colors = node.color.map(mapColor);

    return palette;
}

function mapPart(node) {
    const attrs = node.$;

    return {
        id: num(attrs, 'id'),
        type: str(attrs, 'type'),
        colorable: bool01(attrs, 'colorable'),
        index: num(attrs, 'index'),
        colorindex: num(attrs, 'colorindex')
    };
}

function mapHiddenLayer(node) {
    return { partType: str(node.$, 'parttype') };
}

function mapSet(node) {
    const attrs = node.$;
    const set = {
        id: num(attrs, 'id'),
        gender: str(attrs, 'gender'),
        club: num(attrs, 'club'),
        colorable: bool01(attrs, 'colorable'),
        selectable: bool01(attrs, 'selectable'),
        preselectable: bool01(attrs, 'preselectable'),
        sellable: bool01(attrs, 'sellable')
    };

    if (Array.isArray(node.part)) set.parts = node.part.map(mapPart);

    if (Array.isArray(node.hiddenlayers)) {
        const layers = [];

        for (const wrapper of node.hiddenlayers) {
            if (Array.isArray(wrapper?.layer)) layers.push(...wrapper.layer.map(mapHiddenLayer));
        }

        if (layers.length) set.hiddenLayers = layers;
    }

    return set;
}

function mapSetType(node) {
    const attrs = node.$;
    const setType = {
        type: str(attrs, 'type'),
        paletteId: num(attrs, 'paletteid', 1),
        mandatory_f_0: bool01(attrs, 'mand_f_0'),
        mandatory_f_1: bool01(attrs, 'mand_f_1'),
        mandatory_m_0: bool01(attrs, 'mand_m_0'),
        mandatory_m_1: bool01(attrs, 'mand_m_1')
    };

    if (Array.isArray(node.set)) setType.sets = node.set.map(mapSet);

    return setType;
}

function convertFigureData(xml) {
    const root = xml?.figuredata;

    if (!root) throw new Error('root-element <figuredata> niet gevonden');

    const output = {};

    const palettes = root.colors?.[0]?.palette;
    if (Array.isArray(palettes)) output.palettes = palettes.map(mapPalette);

    const setTypes = root.sets?.[0]?.settype;
    if (Array.isArray(setTypes)) output.setTypes = setTypes.map(mapSetType);

    return output;
}

// ---------------------------------------------------------------------------
// FigureMap.xml -> FigureMap.json
// ---------------------------------------------------------------------------

function mapFigureMapPart(node) {
    const attrs = node.$;

    return { id: num(attrs, 'id'), type: str(attrs, 'type') };
}

function mapFigureMapLibrary(node) {
    const attrs = node.$;
    const library = { id: str(attrs, 'id'), revision: num(attrs, 'revision') };

    if (Array.isArray(node.part)) library.parts = node.part.map(mapFigureMapPart);

    return library;
}

function convertFigureMap(xml) {
    const root = xml?.map;

    if (!root) throw new Error('root-element <map> niet gevonden');

    const output = {};

    if (Array.isArray(root.lib)) output.libraries = root.lib.map(mapFigureMapLibrary);

    return output;
}

// ---------------------------------------------------------------------------
// EffectMap.xml -> EffectMap.json
// ---------------------------------------------------------------------------

function mapEffect(node) {
    const attrs = node.$;

    return {
        id: str(attrs, 'id'),
        lib: str(attrs, 'lib'),
        type: str(attrs, 'type'),
        revision: num(attrs, 'revision')
    };
}

function convertEffectMap(xml) {
    const root = xml?.map;

    if (!root) throw new Error('root-element <map> niet gevonden');

    const output = {};

    if (Array.isArray(root.effect)) output.effects = root.effect.map(mapEffect);

    return output;
}

// ---------------------------------------------------------------------------
// IO / CLI
// ---------------------------------------------------------------------------

const CONVERTERS = {
    figuredata: { file: 'FigureData', convert: convertFigureData },
    figuremap: { file: 'FigureMap', convert: convertFigureMap },
    effectmap: { file: 'EffectMap', convert: convertEffectMap }
};

function printHelp() {
    console.log(`Gebruik: node scripts/gamedata-xml-to-json.mjs [opties]

Opties:
  --in <map>              Map met FigureData.xml / FigureMap.xml / EffectMap.xml (standaard: gamedata-xml)
  --out <map>             Map waar de .json-bestanden komen (standaard: gamedata-json)
  --only <lijst>          Alleen deze onderdelen converteren, komma-gescheiden
                           (figuredata,figuremap,effectmap)
  --figuredata-url <pad>  Eigen bestandspad of http(s)-URL voor FigureData
  --figuremap-url <pad>   Eigen bestandspad of http(s)-URL voor FigureMap
  --effectmap-url <pad>   Eigen bestandspad of http(s)-URL voor EffectMap
  --help                  Toon deze hulptekst
`);
}

async function loadSource(source) {
    if (/^https?:\/\//i.test(source)) {
        const response = await fetch(source);

        if (!response.ok) throw new Error(`HTTP ${response.status} bij ophalen van ${source}`);

        return response.text();
    }

    return readFile(source, 'utf8');
}

function parseArgs(argv) {
    const args = { in: 'gamedata-xml', out: 'gamedata-json', only: Object.keys(CONVERTERS), sources: {} };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg === '--in') {
            args.in = argv[++i];
        } else if (arg === '--out') {
            args.out = argv[++i];
        } else if (arg === '--only') {
            args.only = argv[++i].split(',').map((entry) => entry.trim().toLowerCase());
        } else if (arg.startsWith('--') && arg.endsWith('-url')) {
            const key = arg.slice(2, -4);

            if (!CONVERTERS[key]) {
                console.error(`Onbekende optie: ${arg}`);
                process.exit(1);
            }

            args.sources[key] = argv[++i];
        } else {
            console.error(`Onbekende optie: ${arg}`);
            printHelp();
            process.exit(1);
        }
    }

    return args;
}

async function convertOne(key, entry, args) {
    const source = args.sources[key] ?? path.join(args.in, `${entry.file}.xml`);

    let raw;

    try {
        raw = await loadSource(source);
    } catch (err) {
        console.warn(`${entry.file}: overgeslagen, kon bron niet lezen (${source}): ${err.message}`);

        return;
    }

    const trimmed = raw.trim();

    let json;

    if (trimmed.startsWith('{')) {
        // Bron is al JSON: gewoon doorzetten, net als nitro-converter dat doet.
        json = JSON.parse(trimmed);
    } else {
        // Oude Habbo-exports bevatten vaak losse "&" (bv. in namen). xml2js/de
        // XML-parser stikt daarin, dus escapen we die eerst, zonder al
        // geescapete entities zoals &amp; of &#123; kapot te maken.
        const escaped = trimmed.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
        const xml = await parseStringPromise(escaped);

        json = entry.convert(xml);
    }

    await mkdir(args.out, { recursive: true });

    const outPath = path.join(args.out, `${entry.file}.json`);

    await writeFile(outPath, JSON.stringify(json), 'utf8');

    console.log(`${entry.file}: geschreven naar ${outPath}`);
}

async function run() {
    const args = parseArgs(process.argv.slice(2));

    for (const key of args.only) {
        const entry = CONVERTERS[key];

        if (!entry) {
            console.warn(`Onbekend type overgeslagen: ${key}`);
            continue;
        }

        await convertOne(key, entry, args);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
